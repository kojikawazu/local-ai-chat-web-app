/** バイナリかを判定するときに見る先頭のバイト数（git と同じく、先頭に NUL があればバイナリとみなす） */
const BINARY_SNIFF_BYTES = 8000;

/** 1 行の文字列が長すぎるときに付ける印 */
const ELLIPSIS = '…';

/** {@link sliceLines} の指定。 */
type SliceOptions = {
  /** 読み始める行（1 始まり） */
  start: number;
  /** 読み終わる行（含む）。省略時は上限まで */
  end?: number;
  /** 1 回に返す最大の行数 */
  maxLines: number;
  /** 1 回に返す最大の文字数（行番号を含む） */
  maxChars: number;
};

/** {@link sliceLines} の結果。 */
type SliceResult = {
  /** 行番号付きの本文（`  12| …` の形。行の区切りは改行） */
  text: string;
  /** 返した最初の行（1 始まり） */
  from: number;
  /** 返した最後の行（含む） */
  to: number;
  /** ファイル全体の行数 */
  total: number;
  /** 上限で切ったため、指定した範囲（または末尾）まで返していなければ true */
  truncated: boolean;
};

/**
 * 中身がバイナリかを判定する（先頭に NUL のバイトがあるか）。
 *
 * @param bytes - ファイルの中身（先頭だけでよい）
 * @returns バイナリなら true
 */
export function isBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

/**
 * 本文を行に分ける。改行は `\n`・`\r\n` のどちらも受け、末尾の改行の後ろの空の行は数えない。
 *
 * @param text - 本文
 * @returns 行の配列（空の本文なら空配列）
 */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/**
 * 1 行を上限の文字数で切り詰める。
 *
 * @param line - 行
 * @param max - 上限の文字数
 * @returns 上限以内ならそのまま、超えたら上限まで切って `…` を付けたもの
 */
export function truncateLine(line: string, max: number): string {
  return line.length <= max ? line : `${line.slice(0, max)}${ELLIPSIS}`;
}

/**
 * 行の範囲を、行番号付きで切り出す（#148 の `read_file`）。
 *
 * 行数・文字数の上限のどちらかに達したら、そこで止めて `truncated` にする。
 * 1 行だけで文字数の上限を超える場合も、その行は上限まで切り詰めて返す（何も返さないことは無い）。
 * `start` は 1 以上・全体の行数以下で渡す（範囲の検証は呼び出し側）。
 *
 * @param lines - 行の配列（{@link splitLines} の結果）
 * @param options - 範囲と上限
 * @returns 行番号付きの本文と、返した範囲・全体の行数・切ったか
 */
export function sliceLines(
  lines: string[],
  options: SliceOptions
): SliceResult {
  const total = lines.length;
  const last = Math.min(options.end ?? total, total);
  const width = String(last).length;
  const out: string[] = [];
  let chars = 0;
  let to = options.start - 1;

  for (let n = options.start; n <= last; n++) {
    if (out.length >= options.maxLines) break;
    const prefix = `${String(n).padStart(width)}| `;
    const remaining = options.maxChars - chars - prefix.length;
    const line = lines[n - 1];
    if (line.length > remaining) {
      // 最初の 1 行は切り詰めてでも返す。2 行目以降は、ここで止めて続きを読ませる
      if (out.length === 0) {
        out.push(prefix + truncateLine(line, Math.max(remaining, 0)));
        to = n;
      }
      break;
    }
    out.push(prefix + line);
    chars += prefix.length + line.length + 1;
    to = n;
  }

  return {
    text: out.join('\n'),
    from: options.start,
    to,
    total,
    truncated: to < last,
  };
}

/**
 * ファイル名の検索語を、判定の関数にする（#148 の `search_files`）。
 *
 * `*`（0 文字以上）・`?`（1 文字）を含めばワイルドカードとして名前全体に当て、含まなければ部分一致にする。
 * どちらも大文字・小文字を区別しない。それ以外の正規表現の記号は文字としてそのまま扱う（式は組ませない）。
 *
 * @param query - 検索語
 * @returns ファイル名を受け取り、一致すれば true を返す関数
 */
export function nameMatcher(query: string): (name: string) => boolean {
  if (!/[*?]/.test(query)) {
    const lower = query.toLowerCase();
    return (name) => name.toLowerCase().includes(lower);
  }
  const source = query
    .split('')
    .map((char) =>
      char === '*'
        ? '.*'
        : char === '?'
          ? '.'
          : char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    )
    .join('');
  const pattern = new RegExp(`^${source}$`, 'i');
  return (name) => pattern.test(name);
}

/**
 * バイト数を読みやすい単位にする。
 *
 * @param bytes - バイト数
 * @returns `512B`・`1.2KB`・`3.4MB` の形
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
