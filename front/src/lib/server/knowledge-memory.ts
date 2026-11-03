import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isWithinRoot } from '@/lib/agent/tools/local-files/path-guard';
import { buildPreview } from '@/lib/agent/tools/local-files/diff';
import {
  MEMORY_DIR,
  buildMemoryFile,
  formatMemoryDate,
  memoryRelativePath,
  readMemoryDates,
} from '@/lib/knowledge/memory';
import type { VaultRoot } from '@/lib/knowledge/vault';
import { EmbeddingModelNotFoundError } from '@/lib/llm/ollama';
import {
  VaultUnavailableError,
  git,
  hasGitDir,
  resolveDefaultBranch,
  syncKnowledgeVaultFile,
} from '@/lib/server/knowledge-vault';
import { MAX_KNOWLEDGE_FILE_BYTES } from '@/lib/shared/validation';
import type { MemoryApprovalPreview } from '@/types/agent/tool-call';
import type { MemoryInput } from '@/types/knowledge/memory';

/**
 * 会話から覚えさせたメモ（#236。`docs/28-rag.md`「会話から覚えさせる（Phase D）」）を、メモの保管庫に書くサーバーの処理。
 *
 * 書く前の準備（置き場所の確認・今のファイルとの差分）と、承認の後の書き込み・既定のブランチへのコミット・
 * そのファイルだけの索引への反映を行う。パスはアプリが名前から組み立て、`memories/` の中にだけ書く。
 */

/** git のエラーの文を、利用者へ見せるときに切り詰める長さ */
const MAX_GIT_ERROR_CHARS = 300;

/** 書いた結果（{@link PreparedMemory} の `write`）。 */
export type MemoryWriteResult =
  | {
      /** 書かなかった */
      ok: false;
      /** 書かなかった理由（モデルへ返す文） */
      error: string;
    }
  | {
      /** 書いた */
      ok: true;
      /** 書いたファイルの、保管庫の名前からのパス（`my-chat-memory/memories/x.md`） */
      displayPath: string;
      /** 新規か上書きか */
      mode: MemoryApprovalPreview['mode'];
      /** コミットの短い ID。フォルダの保管庫・コミットに失敗したときは `null` */
      commit: string | null;
      /** コミットに失敗した理由。失敗していなければ `null` */
      commitError: string | null;
      /** 索引に入れたか */
      indexed: boolean;
      /** 索引に入れられなかった理由。入れたなら `null` */
      indexError: string | null;
    };

/** {@link prepareMemoryWrite} の結果。 */
export type PreparedMemory =
  | { ok: false; error: string }
  | {
      ok: true;
      /** 承認で見せる内容 */
      preview: MemoryApprovalPreview;
      /** 承認の後に書く（準備で作った中身をそのまま書く） */
      write: () => Promise<MemoryWriteResult>;
    };

/**
 * 文字列の SHA-256（承認を待つ間に今のファイルが変わったかを比べる）。
 *
 * @param text - 中身
 * @returns 16 進数の SHA-256
 */
function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * git の失敗を、利用者へ見せる 1 行にする（標準エラー出力の最初の行）。
 *
 * @param error - `execFile` が投げた例外
 * @returns 理由の文
 */
function gitErrorMessage(error: unknown): string {
  const stderr =
    error && typeof error === 'object' && 'stderr' in error
      ? String(error.stderr)
      : '';
  const line =
    stderr
      .split('\n')
      .map((value) => value.trim())
      .find(Boolean) ??
    (error instanceof Error ? error.message : String(error));
  return line.slice(0, MAX_GIT_ERROR_CHARS);
}

/**
 * git の保管庫で、チェックアウトしているのが既定のブランチかを確かめる（D5）。
 *
 * @param vault - メモの保管庫
 * @returns 既定のブランチの名前、または書かない理由
 */
async function checkDefaultBranch(
  vault: VaultRoot
): Promise<{ ok: true; branch: string } | { ok: false; error: string }> {
  let branch: string;
  try {
    ({ branch } = await resolveDefaultBranch(vault.root));
  } catch (error) {
    if (error instanceof VaultUnavailableError) {
      return {
        ok: false,
        error: `メモの保管庫（${vault.name}）を読めません: ${error.message}`,
      };
    }
    throw error;
  }
  let current = '';
  try {
    current = (await git(vault.root, ['symbolic-ref', '-q', '--short', 'HEAD']))
      .toString('utf8')
      .trim();
  } catch {
    // ブランチではなくコミットをチェックアウトしている（detached HEAD）
  }
  if (current !== branch) {
    return {
      ok: false,
      error: `メモの保管庫（${vault.name}）は ${current || '特定のコミット'} をチェックアウトしています。${branch} に切り替えてから、もう一度頼んでください（${branch} 以外に書くと索引に入らないため書きませんでした）`,
    };
  }
  return { ok: true, branch };
}

/** 今のメモのファイル（上書きのとき）。 */
type ExistingMemory = { text: string; hash: string };

/**
 * 今のメモのファイルを読む。
 *
 * @param file - ファイルのパス
 * @returns 無ければ `null`、あれば中身、読めない・ふつうのファイルでなければ理由
 */
async function readExistingMemory(
  file: string
): Promise<ExistingMemory | null | { error: string }> {
  let stats;
  try {
    stats = await lstat(file);
  } catch {
    return null;
  }
  // シンボリックリンクはたどらない（保管庫の外を書き換えさせない）
  if (!stats.isFile()) return { error: 'ふつうのファイルではありません' };
  if (stats.size > MAX_KNOWLEDGE_FILE_BYTES) {
    return { error: '大きすぎます（1 MB 超）' };
  }
  const text = await readFile(file, 'utf8');
  return { text, hash: hashText(text) };
}

/**
 * `memories/` のフォルダが、保管庫の中のふつうのフォルダか（無いならよい）を確かめる。
 *
 * @param vault - メモの保管庫
 * @returns よければ `null`、だめなら理由
 */
async function memoryDirError(vault: VaultRoot): Promise<string | null> {
  try {
    const stats = await lstat(path.join(vault.root, MEMORY_DIR));
    if (!stats.isDirectory()) {
      return `メモの保管庫（${vault.name}）の ${MEMORY_DIR} がフォルダではない（シンボリックリンク等）ため書きません`;
    }
  } catch {
    // まだ無い。書くときに作る
  }
  return null;
}

/**
 * 書いたファイルをコミットする（D5）。このファイルだけを入れ、push はしない。
 *
 * @param vault - メモの保管庫
 * @param relativePath - 保管庫の中のパス
 * @param message - コミットの文（アプリが決めた形）
 * @returns コミットの短い ID、または失敗の理由
 */
async function commitMemory(
  vault: VaultRoot,
  relativePath: string,
  message: string
): Promise<{ commit: string } | { error: string }> {
  try {
    await git(vault.root, ['add', '--', relativePath]);
    // --only: 利用者がほかにステージしている変更を入れない
    await git(vault.root, [
      'commit',
      '-q',
      '--only',
      '-m',
      message,
      '--',
      relativePath,
    ]);
    const commit = (await git(vault.root, ['rev-parse', '--short', 'HEAD']))
      .toString('utf8')
      .trim();
    return { commit };
  } catch (error) {
    return { error: gitErrorMessage(error) };
  }
}

/**
 * 書いたファイルだけを索引に入れる（D6。Phase C の同期と同じ規則で読む）。
 *
 * @param vault - メモの保管庫
 * @param relativePath - 保管庫の中のパス
 * @returns 入れられなかった理由。入れたなら `null`
 */
async function indexMemory(
  vault: VaultRoot,
  relativePath: string
): Promise<string | null> {
  const retry = 'ドキュメントのダイアログの「同期」で入れられます';
  try {
    const result = await syncKnowledgeVaultFile(vault, relativePath);
    if (result.status === 'imported' || result.status === 'unchanged') {
      return null;
    }
    return result.status === 'rejected'
      ? `索引に入れられませんでした（${result.error}）`
      : `索引に入りませんでした（${retry}）`;
  } catch (error) {
    if (error instanceof EmbeddingModelNotFoundError) {
      return `埋め込みのモデル（${error.model}）が無いため、索引に入れられませんでした（ollama pull ${error.model} の後、${retry}）`;
    }
    console.error('Failed to index memory:', error);
    return `索引に入れられませんでした。Ollama が起動しているかを確かめてください（${retry}）`;
  }
}

/**
 * メモを書く準備をする（D3〜D7）。置き場所を確かめ、今のファイルとの差分を作る。
 *
 * git の保管庫は、チェックアウトしているのが既定のブランチでなければ書かない。同じ名前のメモがあれば上書き
 * （作った日を保ち、変えた日を今日にする）、中身が同じなら書かない。
 *
 * @param vault - メモの保管庫（`KNOWLEDGE_MEMORY_VAULT`）
 * @param memory - 検証済みのメモ
 * @param now - 今の日時（日付に使う。テストで決めるため引数にする）
 * @returns 承認で見せる内容と書く処理、または書かない理由
 */
export async function prepareMemoryWrite(
  vault: VaultRoot,
  memory: MemoryInput,
  now: Date = new Date()
): Promise<PreparedMemory> {
  try {
    const stats = await lstat(vault.root);
    if (!stats.isDirectory()) throw new Error('not a directory');
  } catch {
    return {
      ok: false,
      error: `メモの保管庫（${vault.name}）のフォルダ（${vault.root}）が見つかりません`,
    };
  }

  const isGit = await hasGitDir(vault.root);
  let branch: string | null = null;
  if (isGit) {
    const checked = await checkDefaultBranch(vault);
    if (!checked.ok) return checked;
    branch = checked.branch;
  }
  const dirError = await memoryDirError(vault);
  if (dirError) return { ok: false, error: dirError };

  const relativePath = memoryRelativePath(memory.name);
  const displayPath = `${vault.name}/${relativePath}`;
  const file = path.join(vault.root, MEMORY_DIR, `${memory.name}.md`);
  const existing = await readExistingMemory(file);
  if (existing && 'error' in existing) {
    return {
      ok: false,
      error: `${displayPath} は${existing.error}。書き換えません`,
    };
  }

  const today = formatMemoryDate(now);
  const dates = existing
    ? readMemoryDates(existing.text)
    : { created: null, updated: null };
  const created = dates.created ?? today;
  if (
    existing &&
    buildMemoryFile(memory, { created, updated: dates.updated ?? today }) ===
      existing.text
  ) {
    return {
      ok: false,
      error: `同じ内容のメモがすでにあります（${displayPath}）。書く必要はありません`,
    };
  }
  const text = buildMemoryFile(memory, { created, updated: today });
  const mode = existing ? 'overwrite' : 'create';
  const { diff, added, removed } = buildPreview(
    mode,
    displayPath,
    existing?.text ?? '',
    text
  );
  const preview: MemoryApprovalPreview = {
    action: 'save-memory',
    mode,
    vault: vault.name,
    path: relativePath,
    diff,
    added,
    removed,
    branch,
  };

  return {
    ok: true,
    preview,
    write: async () => {
      if (isGit) {
        const checked = await checkDefaultBranch(vault);
        if (!checked.ok) return checked;
      }
      const dirErrorNow = await memoryDirError(vault);
      if (dirErrorNow) return { ok: false, error: dirErrorNow };
      const current = await readExistingMemory(file);
      const changed = existing
        ? !current || 'error' in current || current.hash !== existing.hash
        : current !== null;
      if (changed) {
        return {
          ok: false,
          error: `${displayPath} は、承認を待つ間に変わったため書きませんでした。もう一度頼んでください`,
        };
      }

      try {
        const dir = path.join(vault.root, MEMORY_DIR);
        await mkdir(dir, { recursive: true });
        // 作ったフォルダの実体が保管庫の中か（途中で置き換えられていないか）を確かめる
        if (!isWithinRoot(await realpath(dir), vault.root)) {
          return {
            ok: false,
            error: `${MEMORY_DIR} が保管庫の外を指しているため書きません`,
          };
        }
        // 新規は 'wx'（承認を待つ間に同じ名前のファイルができていたら上書きしない）
        await writeFile(file, text, {
          encoding: 'utf8',
          flag: existing ? 'w' : 'wx',
        });
      } catch (error) {
        console.error('Failed to write memory:', error);
        return { ok: false, error: `${displayPath} を書けませんでした` };
      }

      let commit: string | null = null;
      let commitError: string | null = null;
      if (isGit) {
        const verb = existing ? '更新' : '保存';
        const committed = await commitMemory(
          vault,
          relativePath,
          `memory: ${memory.name} を${verb}`
        );
        if ('error' in committed) commitError = committed.error;
        else commit = committed.commit;
      }

      // コミットできなかったファイルは、同期の規則（既定のブランチの中身だけ）で読めないため索引に入れない
      const indexError = commitError
        ? 'コミットしていないため、索引に入れていません'
        : await indexMemory(vault, relativePath);
      return {
        ok: true,
        displayPath,
        mode,
        commit,
        commitError,
        indexed: indexError === null,
        indexError,
      };
    },
  };
}
