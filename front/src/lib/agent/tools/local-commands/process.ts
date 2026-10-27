import { spawn } from 'child_process';

/** モデルへ返す出力のうち、先頭に残す文字数 */
const HEAD_CHARS = 5_000;

/** モデルへ返す出力のうち、末尾に残す文字数。テストの失敗・エラーは末尾に出ることが多いため、先頭より多く残す */
const TAIL_CHARS = 25_000;

/** 止めるとき、`SIGTERM` から `SIGKILL` までの猶予（ミリ秒）。後片付けの時間を与えつつ、止まらないプロセスを残さない */
const KILL_GRACE_MS = 3_000;

/** サーバーの環境変数のうち、コマンドへ引き継ぐもの。アプリの設定（`DATABASE_URL`・`OLLAMA_*` 等）は渡さない */
const INHERITED_ENV_NAMES = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
] as const;

/** コマンドへ足す環境変数。色の制御文字を減らし、認証の入力・ページャー・対話で止まらないようにする */
const FIXED_ENV: Record<string, string> = {
  NO_COLOR: '1',
  FORCE_COLOR: '0',
  TERM: 'dumb',
  GIT_TERMINAL_PROMPT: '0',
  GIT_PAGER: 'cat',
  PAGER: 'cat',
  GH_PROMPT_DISABLED: '1',
};

// 端末の制御文字（ANSI のエスケープ）。CSI（色・カーソル移動。ESC [ ... 終端の 1 文字）と、
// OSC（ESC ] ... BEL か ESC \。リンク・タイトル）と、それ以外の 2 文字のもの（ESC と 1 文字）
const ANSI_PATTERN =
  /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

/** {@link runProcess} の指定。 */
type RunOptions = {
  /** 実行ファイルの実体のパス */
  executable: string;
  /** プログラム名の後ろの引数 */
  args: string[];
  /** 作業フォルダの実体のパス */
  cwd: string;
  /** 実行時間の上限（ミリ秒）。超えたらプロセスグループごと止める */
  timeoutMs: number;
  /** 停止・切断で中断される signal。中断されたらプロセスグループごと止める */
  signal: AbortSignal;
  /** コマンドに渡す環境変数（{@link buildCommandEnv}） */
  env: Record<string, string>;
};

/**
 * コマンドの終わり方。
 *
 * - `exited`: 自分で終了した（終了コード付き）
 * - `signaled`: シグナルで終了した（外から止められた等）
 * - `timeout`: 実行時間の上限で止めた
 * - `aborted`: 停止・切断で止めた
 * - `spawn-error`: 起動できなかった
 */
export type ProcessEnd =
  | { kind: 'exited'; code: number }
  | { kind: 'signaled'; signal: string }
  | { kind: 'timeout' }
  | { kind: 'aborted' }
  | { kind: 'spawn-error'; message: string };

/** {@link runProcess} の結果。 */
export type ProcessResult = {
  /** 終わり方 */
  end: ProcessEnd;
  /** 標準出力と標準エラー出力を届いた順にまとめたもの（制御文字を除き、長ければ先頭と末尾だけ） */
  output: string;
};

/**
 * コマンドに渡す環境変数を作る（#148 Phase B）。
 *
 * サーバーの環境変数のうち {@link INHERITED_ENV_NAMES} だけを引き継ぎ、{@link FIXED_ENV} を足す。
 * `printenv` 等でアプリの設定を読ませないため。
 *
 * @param source - サーバーの環境変数（`process.env`）
 * @returns コマンドに渡す環境変数
 */
export function buildCommandEnv(
  source: Record<string, string | undefined>
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of INHERITED_ENV_NAMES) {
    const value = source[name];
    if (value !== undefined) env[name] = value;
  }
  return { ...env, ...FIXED_ENV };
}

/**
 * 端末の制御文字を取り除き、改行を `\n` に揃える。
 *
 * 進み具合の表示は行頭に戻る `\r` で同じ行を書き直すため、残った `\r` も改行にする。
 *
 * @param text - コマンドの出力
 * @returns 制御文字を除いた文字列
 */
export function cleanOutput(text: string): string {
  return text.replace(ANSI_PATTERN, '').replace(/\r\n?/g, '\n');
}

/**
 * 出力を、先頭と末尾だけを持ちながら溜める入れ物を作る。
 *
 * 全体をメモリに溜めず、先頭の {@link HEAD_CHARS} 文字と末尾の {@link TAIL_CHARS} 文字だけを持つ。
 * 末尾は上限の 2 倍まで溜めてから切り詰める（届くたびに切ると、細かい出力で文字列の作り直しが増えるため）。
 *
 * @param headChars - 先頭に残す文字数
 * @param tailChars - 末尾に残す文字数
 * @returns 追記する関数と、溜めた出力を取り出す関数
 */
export function createOutputBuffer(
  headChars: number = HEAD_CHARS,
  tailChars: number = TAIL_CHARS
) {
  let head = '';
  let tail = '';
  let total = 0;
  return {
    /**
     * 届いた出力を足す。
     *
     * @param chunk - 届いた出力
     */
    push(chunk: string) {
      total += chunk.length;
      const room = Math.max(headChars - head.length, 0);
      head += chunk.slice(0, room);
      tail += chunk.slice(room);
      if (tail.length > tailChars * 2) tail = tail.slice(-tailChars);
    },
    /**
     * 溜めた出力を取り出す。間を省いたら、省いた文字数を書く。
     *
     * @returns 制御文字を除いた出力
     */
    toString(): string {
      const kept = tail.slice(-tailChars);
      const omitted = total - head.length - kept.length;
      return omitted > 0
        ? `${cleanOutput(head)}\n…（${omitted.toLocaleString()} 文字を省略）…\n${cleanOutput(kept)}`
        : cleanOutput(head + kept);
    },
  };
}

/**
 * プロセスグループごとシグナルを送る。グループがもう無ければ何もしない。
 *
 * @param pid - グループの先頭のプロセス ID（`detached: true` で起動したもの）
 * @param signal - 送るシグナル
 */
function killGroup(pid: number, signal: NodeJS.Signals) {
  try {
    // 負の ID はプロセスグループ全体を指す（子・孫のプロセスまで届く）
    process.kill(-pid, signal);
  } catch {
    // すでに終わっている（ESRCH）
  }
}

/**
 * コマンドを、シェルを介さずに実行し、終わるまで待つ（#148 Phase B。`docs/16-command-execution.md`）。
 *
 * 新しいプロセスグループで起動し（`detached: true`）、止めるときはグループごと `SIGTERM`、
 * {@link KILL_GRACE_MS} で終わらなければ `SIGKILL` を送る（`pnpm test` が起動したワーカー等の孫まで止めるため）。
 * 先頭のプロセスが終わった後に残ったグループの中のプロセスも止める（裏で動かし続けることは扱わない）。
 * 標準入力は閉じる（入力を待つコマンドで止まらないように）。失敗も例外にせず {@link ProcessEnd} で返す。
 *
 * @param options - 実行ファイル・引数・作業フォルダ・上限・中断の signal・環境変数
 * @returns 終わり方・出力
 */
export function runProcess({
  executable,
  args,
  cwd,
  timeoutMs,
  signal,
  env,
}: RunOptions): Promise<ProcessResult> {
  const output = createOutputBuffer();
  return new Promise((resolve) => {
    let stopped: 'timeout' | 'aborted' | null = null;
    let exit: ProcessEnd | null = null;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const child = spawn(executable, args, {
      cwd,
      // Next.js の型定義は ProcessEnv に NODE_ENV を必須で足すが、子のプロセスには渡さない
      // （開発サーバーの development が pnpm build 等に漏れないように）。実行時は普通の文字列の対応表で足りる
      env: env as NodeJS.ProcessEnv,
      shell: false,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const settle = (end: ProcessEnd) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal.removeEventListener('abort', onAbort);
      resolve({ end, output: output.toString() });
    };

    const stop = (reason: 'timeout' | 'aborted') => {
      if (stopped || child.pid === undefined) return;
      stopped = reason;
      const pid = child.pid;
      killGroup(pid, 'SIGTERM');
      killTimer = setTimeout(() => killGroup(pid, 'SIGKILL'), KILL_GRACE_MS);
    };
    const onAbort = () => stop('aborted');

    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    if (signal.aborted) stop('aborted');
    else signal.addEventListener('abort', onAbort, { once: true });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => output.push(chunk));
    child.stderr.on('data', (chunk: string) => output.push(chunk));

    child.on('error', (error) => {
      settle({ kind: 'spawn-error', message: error.message });
    });
    child.on('exit', (code, exitSignal) => {
      exit =
        code !== null
          ? { kind: 'exited', code }
          : { kind: 'signaled', signal: exitSignal ?? 'unknown' };
      // 出力の口を持ったまま残った孫がいると close が来ないため、グループに残ったものを止める
      if (child.pid !== undefined) killGroup(child.pid, 'SIGTERM');
    });
    // 出力を読み終えてから決着させる（exit の時点では、まだ届いていない出力がある）
    child.on('close', () => {
      settle(
        stopped
          ? { kind: stopped }
          : (exit ?? { kind: 'signaled', signal: 'unknown' })
      );
    });
  });
}
