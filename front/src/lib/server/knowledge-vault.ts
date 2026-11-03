import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  isSkippedDirName,
  isWithinRoot,
} from '@/lib/agent/tools/local-files/path-guard';
import { buildCommandEnv } from '@/lib/agent/tools/local-commands/process';
import { decodeKnowledgeText } from '@/lib/knowledge/file';
import {
  planVaultSync,
  vaultDocumentName,
  vaultExclusionReason,
  vaultFileKind,
} from '@/lib/knowledge/vault';
import type { VaultRoot } from '@/lib/knowledge/vault';
import { getEmbeddingModel } from '@/lib/llm/ollama';
import { importKnowledgeDocument } from '@/lib/server/knowledge';
import {
  findKnowledgeVault,
  getKnowledgeVaults,
} from '@/lib/server/knowledge-vault-config';
import { prisma } from '@/lib/server/prisma';
import {
  MAX_KNOWLEDGE_FILE_BYTES,
  MAX_KNOWLEDGE_VAULT_FILES,
} from '@/lib/shared/validation';
import type {
  KnowledgeVaultItem,
  VaultExclusionReason,
  VaultFileSyncStatus,
  VaultSource,
  VaultSyncPlanResponse,
} from '@/types/knowledge/vault';

/**
 * RAG の保管庫（#235。`docs/28-rag.md`「保管庫の同期（Phase C）」）のサーバーの処理。
 *
 * 保管庫は `KNOWLEDGE_VAULTS` で決めたフォルダ。git のリポジトリなら既定のブランチのコミット済みの中身だけを、
 * そうでなければ今のフォルダの中身を読む。中身は RAG のドキュメント（名前は `保管庫の名前/パス`）として取り込む。
 */

const execFileAsync = promisify(execFile);

/** git の 1 回の実行の時間の上限（ミリ秒）。読むだけのコマンドなので、手元のリポジトリなら数十ミリ秒で終わる */
const GIT_TIMEOUT_MS = 30_000;

/** git の出力の上限（バイト）。`ls-tree -r` の一覧（2,000 ファイルでも数百 KB）と 1 MB のファイルが収まる大きさ */
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

/** 既定のブランチが分からないときに順に試す名前 */
const FALLBACK_BRANCHES = ['main', 'master'];

/**
 * 保管庫を読めないときのエラー（フォルダが無い・git の既定のブランチが無い・git を実行できない）。
 *
 * route が 500 にして、理由をそのまま画面に出す（ローカル利用のため。設定の誤りに気づけるように）。
 */
export class VaultUnavailableError extends Error {
  /**
   * @param message - 利用者へ見せる理由
   * @param cause - 元の例外
   */
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'VaultUnavailableError';
  }
}

/**
 * 保管庫の中で git を実行する（シェルを介さない。#235 の「セキュリティ」）。
 *
 * 渡す環境変数はコマンドの実行のツールと同じく絞る（`buildCommandEnv`）。同期では読むだけのサブコマンドに使う。
 * 書き込むサブコマンド（`add`・`commit`）は、メモの保管庫（#236。`lib/server/knowledge-memory.ts`）だけが決まった引数で使う。
 *
 * @param root - 保管庫のフォルダ
 * @param args - git の引数（`-C` の後ろ）
 * @returns 標準出力
 * @throws {Error} git が 0 以外で終わった・時間の上限を超えた場合（`stderr` を持つ）
 */
export async function git(root: string, args: string[]): Promise<Buffer> {
  const { stdout } = await execFileAsync('git', ['-C', root, ...args], {
    // Next.js は ProcessEnv の NODE_ENV を必須にしているが、git には要らない（渡す変数を絞るのが目的）。
    // 値はすべて文字列なので、実行時の形は ProcessEnv と同じ
    env: buildCommandEnv(process.env) as NodeJS.ProcessEnv,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    encoding: 'buffer',
  });
  return stdout;
}

/** 保管庫で見つけた 1 つ（ふつうのファイルでないもの・大きいものも含む）。 */
type ListedEntry = {
  /** 保管庫の中のパス（`/` 区切り） */
  path: string;
  /** ふつうのファイルか（シンボリックリンク・サブモジュールは false） */
  isFile: boolean;
  /** バイト数（ふつうのファイルでなければ 0） */
  size: number;
  /** 中身の版を求める。git は blob の ID（読まずに分かる）、フォルダは中身の SHA-256 */
  hash: () => Promise<string>;
};

/** 保管庫の 1 ファイルを読んだ結果。 */
type ReadEntry =
  | { kind: 'missing' }
  | { kind: 'excluded'; reason: VaultExclusionReason }
  | { kind: 'file'; hash: string; bytes: Buffer };

/** 開いた保管庫（git とフォルダを同じ形で扱う）。 */
type OpenedVault = {
  /** 読んだ版 */
  source: VaultSource;
  /** 中のファイルを並べる */
  list: () => Promise<ListedEntry[]>;
  /** 1 ファイルを読む（パスは検証済みのもの） */
  read: (relativePath: string) => Promise<ReadEntry>;
};

/** `git ls-tree -l` の 1 行（`<mode> <type> <object> <size>\t<path>`。size は右寄せの空白付き・サブモジュールは `-`） */
const LS_TREE_LINE = /^(\d{6}) (\w+) ([0-9a-f]+) +(\d+|-)\t([\s\S]+)$/;

/**
 * `git ls-tree -z -l` の出力を読む。
 *
 * @param output - 出力（NUL 区切り）
 * @returns 1 行ずつの、mode・種類・ID・大きさ・パス
 */
function parseLsTree(output: Buffer) {
  return output
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .flatMap((line) => {
      const match = LS_TREE_LINE.exec(line);
      if (!match) return [];
      const [, mode, type, oid, size, entryPath] = match;
      return [
        {
          mode,
          type,
          oid,
          size: size === '-' ? 0 : Number(size),
          path: entryPath,
        },
      ];
    });
}

/**
 * git のふつうのファイル（シンボリックリンク `120000`・サブモジュール `160000` を除く）かを判定する。
 *
 * @param entry - ls-tree の 1 行
 * @param entry.mode - mode
 * @param entry.type - 種類
 * @returns ふつうのファイルなら true
 */
function isGitFile(entry: { mode: string; type: string }): boolean {
  return (
    entry.type === 'blob' &&
    (entry.mode === '100644' || entry.mode === '100755')
  );
}

/**
 * git のリポジトリの既定のブランチを決める（#235 の C2）。
 *
 * `origin/HEAD` が指す名前の手元のブランチ。無ければ `main`、`master` の順に試す。`git fetch` はしない。
 *
 * @param root - リポジトリのフォルダ
 * @returns ブランチの名前と、そのコミットの ID
 * @throws {VaultUnavailableError} どのブランチも無い場合
 */
export async function resolveDefaultBranch(
  root: string
): Promise<{ branch: string; commit: string }> {
  const candidates: string[] = [];
  try {
    const remoteHead = (
      await git(root, [
        'symbolic-ref',
        '-q',
        '--short',
        'refs/remotes/origin/HEAD',
      ])
    )
      .toString('utf8')
      .trim();
    if (remoteHead.startsWith('origin/')) candidates.push(remoteHead.slice(7));
  } catch {
    // origin/HEAD が無い（リモートが無い・設定されていない）。既定の名前を試す
  }
  for (const name of FALLBACK_BRANCHES) {
    if (!candidates.includes(name)) candidates.push(name);
  }
  for (const branch of candidates) {
    try {
      const commit = (
        await git(root, [
          'rev-parse',
          '--verify',
          '-q',
          `refs/heads/${branch}^{commit}`,
        ])
      )
        .toString('utf8')
        .trim();
      if (commit) return { branch, commit };
    } catch {
      // このブランチは手元に無い。次を試す
    }
  }
  throw new VaultUnavailableError(
    `既定のブランチ（${candidates.join('・')}）が手元にありません`
  );
}

/**
 * git のリポジトリの保管庫を開く（既定のブランチのコミット済みの中身だけを読む）。
 *
 * @param root - リポジトリのフォルダ（最上位）
 * @returns 開いた保管庫
 */
async function openGitVault(root: string): Promise<OpenedVault> {
  const { branch, commit } = await resolveDefaultBranch(root);
  return {
    source: { kind: 'git', branch, commit: commit.slice(0, 7) },
    list: async () =>
      parseLsTree(await git(root, ['ls-tree', '-r', '-z', '-l', commit])).map(
        (entry) => ({
          path: entry.path,
          isFile: isGitFile(entry),
          size: entry.size,
          hash: async () => entry.oid,
        })
      ),
    read: async (relativePath) => {
      const [entry] = parseLsTree(
        await git(root, ['ls-tree', '-z', '-l', commit, '--', relativePath])
      ).filter((candidate) => candidate.path === relativePath);
      if (!entry) return { kind: 'missing' };
      if (!isGitFile(entry)) return { kind: 'excluded', reason: 'not_file' };
      if (entry.size > MAX_KNOWLEDGE_FILE_BYTES) {
        return { kind: 'excluded', reason: 'too_large' };
      }
      const bytes = await git(root, ['cat-file', 'blob', entry.oid]);
      return { kind: 'file', hash: entry.oid, bytes };
    },
  };
}

/**
 * 中身の SHA-256（フォルダの保管庫の版）を求める。
 *
 * @param bytes - 中身
 * @returns 16 進数の SHA-256
 */
function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * git でないフォルダの保管庫を開く（今のフォルダの中身を読む）。
 *
 * たどるときは `.` で始まるフォルダ・生成物のフォルダ（`node_modules`・`.venv` 等）に入らない。
 * シンボリックリンクはたどらない（保管庫の外へ出させない）。
 *
 * @param root - フォルダ（実体のパス）
 * @returns 開いた保管庫
 */
function openFolderVault(root: string): OpenedVault {
  return {
    source: { kind: 'folder' },
    list: async () => {
      const entries: ListedEntry[] = [];
      const walk = async (dir: string) => {
        for (const dirent of await readdir(dir, { withFileTypes: true })) {
          const full = path.join(dir, dirent.name);
          const relativePath = path
            .relative(root, full)
            .split(path.sep)
            .join('/');
          if (dirent.isDirectory()) {
            if (dirent.name.startsWith('.') || isSkippedDirName(dirent.name)) {
              continue;
            }
            await walk(full);
            continue;
          }
          if (!dirent.isFile()) {
            entries.push({
              path: relativePath,
              isFile: false,
              size: 0,
              hash: async () => '',
            });
            continue;
          }
          const { size } = await lstat(full);
          entries.push({
            path: relativePath,
            isFile: true,
            size,
            hash: async () => sha256(await readFile(full)),
          });
        }
      };
      await walk(root);
      return entries;
    },
    read: async (relativePath) => {
      const full = path.join(root, ...relativePath.split('/'));
      let stats;
      try {
        stats = await lstat(full);
      } catch {
        return { kind: 'missing' };
      }
      if (!stats.isFile()) return { kind: 'excluded', reason: 'not_file' };
      // 途中のフォルダがシンボリックリンクで外を指していないか（実体で確かめる）
      if (!isWithinRoot(await realpath(full), root)) {
        return { kind: 'excluded', reason: 'not_file' };
      }
      if (stats.size > MAX_KNOWLEDGE_FILE_BYTES) {
        return { kind: 'excluded', reason: 'too_large' };
      }
      const bytes = await readFile(full);
      return { kind: 'file', hash: sha256(bytes), bytes };
    },
  };
}

/**
 * 保管庫の最上位に `.git` があるか（git のリポジトリとして扱うか）を確かめる。
 *
 * @param root - 保管庫のフォルダ
 * @returns `.git` があれば true
 */
export async function hasGitDir(root: string): Promise<boolean> {
  try {
    await lstat(path.join(root, '.git'));
    return true;
  } catch {
    // .git が無い。フォルダとして扱う
    return false;
  }
}

/**
 * 保管庫を開く。最上位に `.git` があれば git のリポジトリとして、無ければフォルダとして開く。
 *
 * `.git` があるのに git を実行できないときは、作業ツリーを読まずに失敗させる（既定のブランチだけを読む約束を守るため）。
 *
 * @param vault - 保管庫
 * @returns 開いた保管庫
 * @throws {VaultUnavailableError} フォルダが無い・git を実行できない・既定のブランチが無い場合
 */
async function openVault(vault: VaultRoot): Promise<OpenedVault> {
  try {
    const stats = await lstat(vault.root);
    if (!stats.isDirectory()) throw new Error('not a directory');
  } catch (error) {
    throw new VaultUnavailableError(
      `保管庫のフォルダ（${vault.root}）が見つかりません`,
      error
    );
  }
  if (!(await hasGitDir(vault.root))) return openFolderVault(vault.root);
  try {
    await git(vault.root, ['rev-parse', '--git-dir']);
  } catch (error) {
    throw new VaultUnavailableError(
      `保管庫（${vault.name}）の git を実行できません`,
      error
    );
  }
  return openGitVault(vault.root);
}

/**
 * 保管庫のファイルを並べ、取り込む候補と、取り込まない理由ごとの数に分ける。
 *
 * @param opened - 開いた保管庫
 * @returns 候補（パスと、版を求める関数）と、理由ごとの数
 */
async function collectCandidates(opened: OpenedVault) {
  const candidates: ListedEntry[] = [];
  const excluded = new Map<VaultExclusionReason, number>();
  for (const entry of await opened.list()) {
    const reason =
      vaultExclusionReason(entry.path) ??
      (!entry.isFile
        ? 'not_file'
        : entry.size > MAX_KNOWLEDGE_FILE_BYTES
          ? 'too_large'
          : null);
    if (reason) excluded.set(reason, (excluded.get(reason) ?? 0) + 1);
    else candidates.push(entry);
  }
  return { candidates, excluded };
}

/** {@link planKnowledgeVault} の結果。上限に当たったときは数を返す（例外にしない）。 */
export type VaultPlanResult =
  | { ok: true; plan: VaultSyncPlanResponse }
  | { ok: false; reason: 'too_many_files'; count: number };

/**
 * 保管庫の同期の差分を求める（#235）。
 *
 * git の保管庫は blob の ID で比べるため中身を読まない。フォルダの保管庫は候補のファイルを読んで SHA-256 を求める。
 *
 * @param vault - 保管庫（設定にあるもの）
 * @returns 差分。候補が {@link MAX_KNOWLEDGE_VAULT_FILES} を超えれば、その数
 * @throws {VaultUnavailableError} 保管庫を読めない場合
 */
export async function planKnowledgeVault(
  vault: VaultRoot
): Promise<VaultPlanResult> {
  const opened = await openVault(vault);
  const { candidates, excluded } = await collectCandidates(opened);
  if (candidates.length > MAX_KNOWLEDGE_VAULT_FILES) {
    return { ok: false, reason: 'too_many_files', count: candidates.length };
  }
  const files = await Promise.all(
    candidates.map(async (entry) => ({
      path: entry.path,
      hash: await entry.hash(),
    }))
  );
  const documents = await prisma.knowledgeDocument.findMany({
    where: { vault: vault.name },
    select: { name: true, sourceHash: true, embeddingModel: true },
  });
  const plan = planVaultSync(vault.name, files, documents, getEmbeddingModel());
  return {
    ok: true,
    plan: {
      ...plan,
      source: opened.source,
      excluded: [...excluded.entries()].map(([reason, count]) => ({
        reason,
        count,
      })),
    },
  };
}

/** {@link syncKnowledgeVaultFile} の結果。`rejected` のときは理由を持つ。 */
export type VaultFileSyncResult =
  | { status: Exclude<VaultFileSyncStatus, 'rejected'> }
  | { status: 'rejected'; error: string };

/**
 * 保管庫のファイルのドキュメントを索引から消す。
 *
 * @param name - ドキュメントの名前
 * @returns 消したなら true
 */
async function removeVaultDocument(name: string): Promise<boolean> {
  const { count } = await prisma.knowledgeDocument.deleteMany({
    where: { name },
  });
  return count > 0;
}

/**
 * 保管庫の 1 ファイルを同期する（#235）。同じパスを何度呼んでも結果は同じ。
 *
 * サーバーがその場で取り込まない規則を当て直して読む（差分の結果を信用しない）。
 * - 取り込むファイル: 版とモデルが同じなら何もしない（`unchanged`）。違えば取り込む（`imported`）
 * - 無い・取り込まないファイル: 索引にあれば消す（`removed`）
 * - 中身がテキストでない・空・チャンクが多すぎる: 索引から消し、理由を返す
 *
 * @param vault - 保管庫（設定にあるもの）
 * @param relativePath - 保管庫の中のパス（`normalizeVaultPath` を通ったもの）
 * @returns 結果。中身を取り込めなければ `rejected` と理由
 * @throws {VaultUnavailableError} 保管庫を読めない場合
 * @throws {EmbeddingModelNotFoundError} 埋め込みのモデルが Ollama に無い場合
 * @throws {EmbeddingUnavailableError} そのほかの理由で埋め込みを作れない場合
 */
export async function syncKnowledgeVaultFile(
  vault: VaultRoot,
  relativePath: string
): Promise<VaultFileSyncResult> {
  const name = vaultDocumentName(vault.name, relativePath);
  const kind = vaultFileKind(relativePath);
  const opened = await openVault(vault);
  // 取り込まないパスは読まずに、索引にあれば消す（差分の「消えた」と同じ扱い）
  if (!kind || vaultExclusionReason(relativePath)) {
    await removeVaultDocument(name);
    return { status: 'removed' };
  }
  const entry = await opened.read(relativePath);
  if (entry.kind !== 'file') {
    await removeVaultDocument(name);
    return { status: 'removed' };
  }

  const model = getEmbeddingModel();
  const existing = await prisma.knowledgeDocument.findUnique({
    where: { name },
    select: { sourceHash: true, embeddingModel: true },
  });
  if (
    existing?.sourceHash === entry.hash &&
    existing.embeddingModel === model
  ) {
    return { status: 'unchanged' };
  }

  const decoded = decodeKnowledgeText(entry.bytes);
  if (!decoded.ok) {
    await removeVaultDocument(name);
    return { status: 'rejected', error: decoded.error };
  }
  const result = await importKnowledgeDocument({
    name,
    kind,
    ...decoded.value,
    vault: vault.name,
    sourceHash: entry.hash,
  });
  if (!result.ok) {
    await removeVaultDocument(name);
    return {
      status: 'rejected',
      error:
        'ドキュメントが細かく分かれすぎるため取り込めません（見出し・段落を減らすか、ファイルを分けてください）',
    };
  }
  return { status: 'imported' };
}

/** 保管庫ごとの索引の数（{@link listKnowledgeVaults} で使う）。 */
type VaultStatsRow = {
  vault: string;
  documentCount: number;
  chunkCount: number;
  needsRebuildCount: number;
  lastUpdatedAt: Date | null;
};

/**
 * 保管庫の一覧（設定にあるもの + 索引だけ残っているもの）を返す（#235）。
 *
 * 設定にある保管庫は開いて、読む版（ブランチとコミット）を確かめる。読めなければ理由を `error` に入れる。
 *
 * @returns 保管庫（設定の順、その後に索引だけ残っているものを名前の順）
 */
export async function listKnowledgeVaults(): Promise<KnowledgeVaultItem[]> {
  const model = getEmbeddingModel();
  const rows = await prisma.$queryRaw<VaultStatsRow[]>`
    SELECT d."vault" AS "vault",
           count(DISTINCT d."id")::int AS "documentCount",
           count(c."id")::int AS "chunkCount",
           count(DISTINCT d."id") FILTER (WHERE d."embeddingModel" <> ${model})::int AS "needsRebuildCount",
           max(d."updatedAt") AS "lastUpdatedAt"
    FROM "KnowledgeDocument" d LEFT JOIN "KnowledgeChunk" c ON c."documentId" = d."id"
    WHERE d."vault" IS NOT NULL
    GROUP BY d."vault"`;
  const stats = new Map(rows.map((row) => [row.vault, row]));
  const toCounts = (name: string) => {
    const row = stats.get(name);
    return {
      documentCount: row?.documentCount ?? 0,
      chunkCount: row?.chunkCount ?? 0,
      needsRebuildCount: row?.needsRebuildCount ?? 0,
      lastUpdatedAt: row?.lastUpdatedAt?.toISOString() ?? null,
    };
  };

  const configured = await Promise.all(
    getKnowledgeVaults().map(async (vault): Promise<KnowledgeVaultItem> => {
      let source: VaultSource | null = null;
      let error: string | null = null;
      try {
        source = (await openVault(vault)).source;
      } catch (cause) {
        if (!(cause instanceof VaultUnavailableError)) throw cause;
        error = cause.message;
      }
      return {
        name: vault.name,
        root: vault.root,
        configured: true,
        source,
        error,
        ...toCounts(vault.name),
      };
    })
  );
  const configuredNames = new Set(configured.map((vault) => vault.name));
  const orphaned = rows
    .map((row) => row.vault)
    .filter((name) => !configuredNames.has(name))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((name): KnowledgeVaultItem => ({
      name,
      root: null,
      configured: false,
      source: null,
      error: null,
      ...toCounts(name),
    }));
  return [...configured, ...orphaned];
}

/** {@link deleteKnowledgeVaultIndex} の結果。 */
export type VaultDeleteResult = 'deleted' | 'configured' | 'not_found';

/**
 * 設定に無い保管庫の索引を消す（#235 の C7）。
 *
 * 設定にある保管庫は消さない（次の同期で戻るため。外してから消す）。
 *
 * @param name - 保管庫の名前
 * @returns 消した・設定にある・索引に無い
 */
export async function deleteKnowledgeVaultIndex(
  name: string
): Promise<VaultDeleteResult> {
  if (findKnowledgeVault(name)) return 'configured';
  const { count } = await prisma.knowledgeDocument.deleteMany({
    where: { vault: name },
  });
  return count > 0 ? 'deleted' : 'not_found';
}
