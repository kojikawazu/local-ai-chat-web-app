import { parsePositiveIntEnv } from '../../agent-config';

/** コマンドの実行時間の既定（ミリ秒。120 秒）。ユニットテスト・型チェックが収まる長さ */
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;

/** コマンドの実行時間として受け付ける上限（ミリ秒。10 分）。ストリームを開いたまま待つため、際限なくは待たない */
const COMMAND_TIMEOUT_MS_LIMIT = 600_000;

/**
 * 許可リストに書いても使わないプログラム（#148 Phase B。`docs/16-command-execution.md`）。
 *
 * シェルと、別のプログラムを起動するためのもの。通すと `bash -c "..."`・`env rm ...` の形で、
 * 許可リストとシェルを介さない方針の両方を素通りできるため。
 */
const DENIED_PROGRAMS = new Set([
  'sh',
  'bash',
  'zsh',
  'fish',
  'dash',
  'ksh',
  'csh',
  'tcsh',
  'sudo',
  'su',
  'doas',
  'env',
  'xargs',
  'nohup',
  'nice',
  'time',
  'timeout',
]);

/** {@link parseCommandList} の結果。 */
type CommandList = {
  /** 実行してよいプログラムの名前 */
  programs: string[];
  /** `/` を含むため外した値（パスでの指定は受け付けない） */
  invalid: string[];
  /** {@link DENIED_PROGRAMS} に当たるため外した値 */
  denied: string[];
};

/**
 * プログラムの名前が、許可リストに書いても使わないもの（シェル等）かを判定する。
 *
 * macOS のファイルシステムは大文字・小文字を区別しないため（`Bash` でも bash が起動する）、小文字にして比べる。
 *
 * @param name - プログラムの名前
 * @returns 使わないものなら true
 */
export function isDeniedProgram(name: string): boolean {
  return DENIED_PROGRAMS.has(name.toLowerCase());
}

/**
 * `LOCAL_COMMANDS` の値を、実行してよいプログラムの名前の一覧に分ける（#148 Phase B。fs に触れない）。
 *
 * カンマで区切り、前後の空白と空の要素を捨て、重なりをまとめる。`/` を含む値（パス）と、
 * シェル・別のプログラムを起動するもの（{@link isDeniedProgram}）は外す。
 *
 * @param raw - 環境変数の値。未設定なら `undefined`
 * @returns 実行してよい名前と、外した値
 */
export function parseCommandList(raw: string | undefined): CommandList {
  const programs = new Set<string>();
  const invalid: string[] = [];
  const denied: string[] = [];
  for (const item of (raw ?? '').split(',')) {
    const name = item.trim();
    if (!name) continue;
    if (name.includes('/')) invalid.push(name);
    else if (isDeniedProgram(name)) denied.push(name);
    else programs.add(name);
  }
  return { programs: [...programs], invalid, denied };
}

/** 起動後に 1 度だけ解釈した結果。`undefined` はまだ解釈していない */
let cachedCommands: string[] | undefined;

/**
 * エージェントが実行してよいプログラムを、環境変数 `LOCAL_COMMANDS` から解決する（#148 Phase B）。
 *
 * 初めて呼んだときに 1 度だけ解釈する（変えたら開発サーバーを再起動する）。外した値は `console.warn` で知らせる。
 * `process.env.LOCAL_COMMANDS` を読むのはこの関数だけ。
 *
 * @returns 実行してよいプログラムの名前。未設定・全部外れたら空配列（ツールを使わない）
 */
export function getLocalCommands(): string[] {
  if (cachedCommands) return cachedCommands;
  const { programs, invalid, denied } = parseCommandList(
    process.env.LOCAL_COMMANDS
  );
  for (const value of invalid) {
    console.warn(
      `LOCAL_COMMANDS の "${value}" はパスのため使いません（プログラムの名前で書いてください）`
    );
  }
  for (const value of denied) {
    console.warn(
      `LOCAL_COMMANDS の "${value}" はシェル・別のプログラムを起動するもののため使いません`
    );
  }
  cachedCommands = programs;
  return cachedCommands;
}

/**
 * コマンドの実行時間の上限を、環境変数 `LOCAL_COMMAND_TIMEOUT_MS` から解決する（#148 Phase B）。
 *
 * ツール全般の上限（`AGENT_TOOL_TIMEOUT_MS`。30 秒）とは別に持つ。テスト・ビルドは 30 秒で終わらず、
 * ツール全般の上限を上げると Web の取得が止まったときの待ちまで長くなるため。
 *
 * @returns 実行時間の上限（ミリ秒）。未設定・不正なら 120 秒
 */
export function getCommandTimeoutMs(): number {
  return parsePositiveIntEnv(
    'LOCAL_COMMAND_TIMEOUT_MS',
    process.env.LOCAL_COMMAND_TIMEOUT_MS,
    { fallback: DEFAULT_COMMAND_TIMEOUT_MS, max: COMMAND_TIMEOUT_MS_LIMIT }
  );
}
