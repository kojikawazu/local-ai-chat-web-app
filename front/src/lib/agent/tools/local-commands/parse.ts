/** コマンドの文字列の最大の長さ。普通のコマンドで足り、これより長いものは承認カードで読めない */
const MAX_COMMAND_CHARS = 4_000;

/** 引数の最大の数（プログラム名を含む） */
const MAX_ARGS = 100;

/**
 * クォートの外に書かれたら断る、シェルの記号。
 *
 * シェルを介さないため注入にはならないが、モデルが `pnpm test | tail` のようにシェルのつもりで書いたとき、
 * 記号がただの引数として渡って意図しない動きになるのを防ぐ（`$(` は `$` の後で別に判定する）。
 */
const SHELL_OPERATORS = new Set([
  '|',
  '&',
  ';',
  '<',
  '>',
  '`',
  '(',
  ')',
  '\n',
  '\r',
]);

/** クォートせずに見せてよい引数（英数字と、シェルで意味を持たない記号だけ） */
const SAFE_ARG_PATTERN = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** パイプ等を断るときの理由 */
const OPERATOR_REASON =
  'パイプ・リダイレクト・つなげての実行（| > < ; & ` $( など）はできません。コマンドを 1 つずつ実行してください（記号を引数として渡すならクォートで囲んでください）';

/** {@link parseCommandLine} の結果。 */
type ParseResult =
  | {
      ok: true;
      /** 引数の配列（先頭がプログラム名） */
      argv: string[];
    }
  | {
      ok: false;
      /** 断る理由（モデルへ返す文章） */
      reason: string;
    };

/**
 * コマンドの文字列を、シェルを使わずに引数の配列に分ける（#148 Phase B。`docs/16-command-execution.md`）。
 *
 * - 空白で区切る。`'...'` の中はそのまま、`"..."` の中は `\"` と `\\` だけを解釈する。クォートの外の `\` は次の 1 文字をそのまま使う
 * - クォートの外のシェルの記号（{@link SHELL_OPERATORS}・`$(`）は断る
 * - ワイルドカード（`*`）・`~`・`$VAR` は展開せず、そのままの文字として渡す
 *
 * @param input - モデルが渡したコマンドの文字列
 * @returns 引数の配列。分けられなければ理由
 */
export function parseCommandLine(input: unknown): ParseResult {
  if (typeof input !== 'string' || input.trim() === '') {
    return {
      ok: false,
      reason: 'command に実行するコマンドを指定してください',
    };
  }
  if (input.length > MAX_COMMAND_CHARS) {
    return {
      ok: false,
      reason: `command が長すぎます（${input.length.toLocaleString()} 文字。上限 ${MAX_COMMAND_CHARS.toLocaleString()} 文字）`,
    };
  }
  if (input.includes('\0')) {
    return { ok: false, reason: 'command に使えない文字が含まれています' };
  }

  const argv: string[] = [];
  let current = '';
  // 空のクォート（''）も 1 つの引数にするため、文字の有無ではなく「引数を書き始めたか」で持つ
  let started = false;
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quote === "'") {
      if (char === "'") quote = null;
      else current += char;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = null;
      else if (
        char === '\\' &&
        (input[i + 1] === '"' || input[i + 1] === '\\')
      ) {
        current += input[++i];
      } else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (char === '\\') {
      if (i + 1 >= input.length) {
        return { ok: false, reason: 'command が \\ で終わっています' };
      }
      current += input[++i];
      started = true;
    } else if (
      SHELL_OPERATORS.has(char) ||
      (char === '$' && input[i + 1] === '(')
    ) {
      return { ok: false, reason: OPERATOR_REASON };
    } else if (char === ' ' || char === '\t') {
      if (started) argv.push(current);
      current = '';
      started = false;
    } else {
      current += char;
      started = true;
    }
  }

  if (quote) {
    return {
      ok: false,
      reason: `command のクォート（${quote}）が閉じていません`,
    };
  }
  if (started) argv.push(current);
  if (argv.length === 0) {
    return {
      ok: false,
      reason: 'command に実行するコマンドを指定してください',
    };
  }
  if (argv.length > MAX_ARGS) {
    return {
      ok: false,
      reason: `引数が多すぎます（${argv.length} 個。上限 ${MAX_ARGS} 個）`,
    };
  }
  return { ok: true, argv };
}

/**
 * 引数の配列を、区切りが分かる 1 行に戻す（承認カード・結果の文章に出す）。
 *
 * 英数字と一部の記号だけの引数はそのまま、それ以外（空白・クォート・空の引数）はシングルクォートで囲む。
 * モデルが書いた文字列ではなく、実際に渡す引数の区切りを利用者に見せるため。
 *
 * @param argv - 引数の配列
 * @returns `git commit -m 'fix: a b'` の形
 */
export function quoteArgv(argv: string[]): string {
  return argv
    .map((arg) =>
      SAFE_ARG_PATTERN.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`
    )
    .join(' ');
}
