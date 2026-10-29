import { realpath } from 'fs/promises';
import { tmpdir } from 'os';
import type { GitHubVisibility } from '@/types/agent/tool-call';
import type { ToolExecution } from '../types';
import { toolError, toolUnavailable } from '../output';
import { buildCommandEnv, runProcess } from '../local-commands/process';
import { findExecutable } from '../local-commands/resolve';

/** 1 回の `gh` の時間の上限（ミリ秒）。ツール全般の上限（`AGENT_TOOL_TIMEOUT_MS`。30 秒）より短くし、止めた理由を返せるようにする */
const GH_TIMEOUT_MS = 20_000;

/** `gh` が「ログインが要る」ときの終了コード（`gh help exit-codes`） */
const AUTH_REQUIRED_EXIT_CODE = 4;

/**
 * `gh` の標準出力として受け取る上限（文字数）。差分を絞るには全体が要るため大きめにし、
 * それでも超える応答は読まずに失敗にする（メモリを際限なく使わない）
 */
const MAX_STDOUT_CHARS = 5_000_000;

/** 失敗のときにモデルへ返す `gh` のエラーの文の上限（文字数） */
const MAX_ERROR_CHARS = 1_000;

/** 失敗の要約（画面の見出し）に出すエラーの文の上限（文字数） */
const MAX_ERROR_SUMMARY_CHARS = 100;

/** `run_command` と同じ絞った環境変数に足すもの。更新のお知らせを出させない */
const GH_ENV = { GH_NO_UPDATE_NOTIFIER: '1' };

/** {@link runGh} の結果。失敗ならモデルへ返す結果を持つ */
type GhResult =
  { ok: true; stdout: string } | { ok: false; output: ToolExecution };

/** {@link runGhJson} の結果。 */
type GhJsonResult =
  { ok: true; value: unknown } | { ok: false; output: ToolExecution };

/** リポジトリの、承認カード・PR の作成に使う情報（{@link getRepoInfo}） */
type RepoInfo = {
  /** 公開か非公開か */
  visibility: GitHubVisibility;
  /** 既定のブランチ */
  defaultBranch: string;
};

/** サーバーが動いている間に取ったリポジトリの情報。公開・非公開と既定のブランチはめったに変わらないため覚えておく */
const repoInfoCache = new Map<string, RepoInfo>();

/**
 * 標準出力を、切り詰めずに上限まで溜める入れ物を作る。上限を超えたら、それ以降は捨てて印を付ける。
 *
 * @returns 追記する関数・溜めた出力・上限を超えたか
 */
function createStdoutCollector() {
  let text = '';
  let overflow = false;
  return {
    /**
     * 届いた出力を足す。
     *
     * @param chunk - 届いた出力
     */
    push(chunk: string) {
      if (overflow) return;
      if (text.length + chunk.length > MAX_STDOUT_CHARS) {
        overflow = true;
        text = '';
        return;
      }
      text += chunk;
    },
    /**
     * 溜めた出力。
     *
     * @returns 上限までの標準出力（上限を超えたら空）
     */
    get text() {
      return text;
    },
    /**
     * 上限を超えたか。
     *
     * @returns 超えたら true
     */
    get overflow() {
      return overflow;
    },
  };
}

/**
 * `gh` が失敗したときの結果を作る。モデルへはエラーの文を付けて返し（直せるように）、見出しには 1 行目だけを出す。
 *
 * @param code - 終了コード
 * @param stderr - `gh` の標準エラー出力
 * @returns `isError: true` の実行結果
 */
function ghFailed(code: number, stderr: string): ToolExecution {
  const message = stderr.trim();
  if (!message) return toolError(`gh が失敗しました（終了コード ${code}）`);
  const firstLine = message.split('\n')[0];
  return {
    result: `エラー: gh が失敗しました（終了コード ${code}）\n${message.slice(0, MAX_ERROR_CHARS)}`,
    isError: true,
    summary: firstLine.slice(0, MAX_ERROR_SUMMARY_CHARS),
  };
}

/**
 * `gh` を、アプリが組み立てた引数で実行する（#148 Phase C。`docs/17-github-tools.md`「gh の呼び方」）。
 *
 * `gh` は使うたびに `PATH` から探して実体のパスで起動する。シェルを介さず（`runProcess`）、作業フォルダは OS の一時フォルダ
 * （いつも `--repo` を付けるため、手元のリポジトリの設定を読ませない）、環境変数は `run_command` と同じく絞る
 * （`GH_TOKEN` 等は渡さず、`gh auth login` のログインを使う）。
 *
 * @param args - `gh` の後ろの引数（検証済みの値だけで組み立てたもの）
 * @param signal - 停止・切断で中断される signal
 * @returns 標準出力。失敗ならモデルへ返す結果（`gh` が無い・未ログインは接続先ごと使えない失敗）
 */
export async function runGh(
  args: string[],
  signal: AbortSignal
): Promise<GhResult> {
  const gh = await findExecutable('gh', process.env.PATH);
  if (!gh.ok) {
    return {
      ok: false,
      output: toolUnavailable(
        'gh（GitHub CLI）が見つかりません。GitHub CLI を入れて、gh auth login でログインしてください'
      ),
    };
  }

  const stdout = createStdoutCollector();
  const { end, output } = await runProcess({
    executable: gh.path,
    args,
    cwd: await realpath(tmpdir()),
    timeoutMs: GH_TIMEOUT_MS,
    signal,
    env: { ...buildCommandEnv(process.env), ...GH_ENV },
    stdout,
  });

  switch (end.kind) {
    case 'exited':
      if (end.code === AUTH_REQUIRED_EXIT_CODE) {
        return {
          ok: false,
          output: toolUnavailable(
            'gh にログインしていません。gh auth login でログインしてください'
          ),
        };
      }
      if (end.code !== 0)
        return { ok: false, output: ghFailed(end.code, output) };
      if (stdout.overflow) {
        return {
          ok: false,
          output: toolError(
            `GitHub の応答が大きすぎるため読めませんでした（${MAX_STDOUT_CHARS.toLocaleString()} 文字まで）`
          ),
        };
      }
      return { ok: true, stdout: stdout.text };
    case 'timeout':
      return {
        ok: false,
        output: toolError(
          `GitHub の応答が ${GH_TIMEOUT_MS / 1000} 秒で返らなかったため止めました`
        ),
      };
    case 'aborted':
      // 停止・切断ではループごと止まり、この結果はモデルへ返らない。記録のためだけに作る
      return { ok: false, output: toolError('停止したため、止めました') };
    case 'signaled':
      return {
        ok: false,
        output: toolError(`gh が ${end.signal} で終了しました`),
      };
    case 'spawn-error':
      return {
        ok: false,
        output: toolUnavailable(`gh を起動できませんでした（${end.message}）`),
      };
  }
}

/**
 * `gh` を `--json` 付きで実行し、標準出力を JSON として読む。
 *
 * @param args - `gh` の後ろの引数（`--json` を含む）
 * @param signal - 停止・切断で中断される signal
 * @returns 読んだ値（形は呼び出し側が確かめる）。失敗ならモデルへ返す結果
 */
export async function runGhJson(
  args: string[],
  signal: AbortSignal
): Promise<GhJsonResult> {
  const ran = await runGh(args, signal);
  if (!ran.ok) return ran;
  try {
    return { ok: true, value: JSON.parse(ran.stdout) as unknown };
  } catch {
    return {
      ok: false,
      output: toolError(
        'GitHub の応答を読めませんでした（JSON ではありません）'
      ),
    };
  }
}

/**
 * `gh repo view --json visibility,defaultBranchRef` の値を、リポジトリの情報にする。
 *
 * @param value - `gh` の JSON
 * @returns リポジトリの情報。形が合わなければ `null`
 */
export function parseRepoInfo(value: unknown): RepoInfo | null {
  if (!value || typeof value !== 'object') return null;
  // gh の JSON は形が保証されないため、項目を unknown のまま取り出し、直後に文字列かを確かめる
  const { visibility, defaultBranchRef } = value as {
    visibility?: unknown;
    defaultBranchRef?: { name?: unknown } | null;
  };
  const defaultBranch = defaultBranchRef?.name;
  if (typeof visibility !== 'string' || typeof defaultBranch !== 'string') {
    return null;
  }
  // PRIVATE・INTERNAL はどちらも誰でも読めるわけではないため、非公開として扱う
  return {
    visibility: visibility.toUpperCase() === 'PUBLIC' ? 'public' : 'private',
    defaultBranch,
  };
}

/**
 * リポジトリの公開・非公開と既定のブランチを取る（承認カード・PR の作成の準備で使う）。
 *
 * 取れたものはサーバーが動いている間は覚えておく（取れなかったものは覚えない）。
 *
 * @param repo - リポジトリ（`owner/name`。検証済み）
 * @param signal - 停止・切断で中断される signal
 * @returns リポジトリの情報。失敗ならモデルへ返す結果
 */
export async function getRepoInfo(
  repo: string,
  signal: AbortSignal
): Promise<
  { ok: true; info: RepoInfo } | { ok: false; output: ToolExecution }
> {
  const cached = repoInfoCache.get(repo);
  if (cached) return { ok: true, info: cached };
  const json = await runGhJson(
    ['repo', 'view', repo, '--json', 'visibility,defaultBranchRef'],
    signal
  );
  if (!json.ok) return json;
  const info = parseRepoInfo(json.value);
  if (!info) {
    return {
      ok: false,
      output: toolError(`${repo} の情報を読めませんでした`),
    };
  }
  repoInfoCache.set(repo, info);
  return { ok: true, info };
}
