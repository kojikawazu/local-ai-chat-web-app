import type { ParseResult } from '@/lib/server/request-body';
import {
  MAX_SEARCH_QUERY_LENGTH,
  MAX_SEARCH_TERMS,
} from '@/lib/shared/validation';

/**
 * 会話検索（#11）のキーワードの解釈・抜粋の切り出し・強調の分割を行う純関数群。
 *
 * Route Handler（検索 API）とクライアント（サイドバーの強調表示）の両方から使うため、
 * `next/server` や Prisma の実体には依存させない。
 */

// 抜粋で、一致箇所の前後に残す文字数
const SNIPPET_RADIUS = 40;

/** 会話検索の API（`GET /api/conversations/search`）の検証済みのクエリ。 */
export type SearchQuery = {
  /** 空白で区切ったキーワード（重複を除く）。すべてを含むものを探す（AND）。`allowEmpty` で空の `q` を受けたときは空 */
  terms: string[];
  /** 何件目から返すか（0 始まり）。「さらに表示」で使う */
  offset: number;
};

/** 強調表示のために分割した文字列の 1 片。 */
export type HighlightPart = {
  /** 文字列の 1 片 */
  text: string;
  /** キーワードに一致した片なら true */
  match: boolean;
};

/**
 * キーワードを空白（全角の空白を含む）で区切り、大文字・小文字を区別せずに重複を除く。
 *
 * @param query - 検索欄に入力された文字列
 * @returns キーワードの一覧（入力順）。空白だけなら空配列
 */
export function parseSearchTerms(query: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const term of query.split(/\s+/)) {
    const key = term.toLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }
  return terms;
}

/**
 * 検索の API のクエリパラメータ（`q`・`offset`）を検証する。
 *
 * 会話の検索（#11）と、ブックマークの一覧（#30。`allowEmpty`）で同じ解釈にそろえる。
 *
 * @param params - リクエストの URL のクエリパラメータ
 * @param options - `allowEmpty` が true なら、空の `q` を「絞り込まない」（`terms` が空）として受け付ける。省略時は false
 * @returns 検証済みのキーワードと開始位置。空（`allowEmpty` でないとき）・長すぎる・語が多すぎる `q`、
 *   0 以上の整数でない `offset` はエラーメッセージを返す
 */
export function parseSearchQuery(
  params: URLSearchParams,
  options: { allowEmpty?: boolean } = {}
): ParseResult<SearchQuery> {
  const query = (params.get('q') ?? '').trim();
  if (!query && !options.allowEmpty) {
    return { ok: false, error: 'キーワードを入力してください' };
  }
  if (query.length > MAX_SEARCH_QUERY_LENGTH) {
    return {
      ok: false,
      error: `キーワードは ${MAX_SEARCH_QUERY_LENGTH} 文字以内で入力してください`,
    };
  }
  const terms = parseSearchTerms(query);
  if (terms.length > MAX_SEARCH_TERMS) {
    return {
      ok: false,
      error: `キーワードは ${MAX_SEARCH_TERMS} 語までにしてください`,
    };
  }

  const rawOffset = params.get('offset');
  if (rawOffset === null) return { ok: true, value: { terms, offset: 0 } };
  const offset = Number(rawOffset);
  // 数字だけを受け付ける（Number は空文字・空白・"1e3"・"0x10" も数値にしてしまうため）
  if (!/^\d+$/.test(rawOffset) || !Number.isSafeInteger(offset)) {
    return { ok: false, error: 'offset は 0 以上の整数で指定してください' };
  }
  return { ok: true, value: { terms, offset } };
}

/**
 * キーワードを、`LIKE` のパターンの中で文字そのものとして扱われるようにエスケープする。
 *
 * Prisma の `contains` は値を `LIKE '%<値>%'` に埋め込むが、値の中の `%`・`_` はエスケープしない
 * （`%` だけで検索するとすべての会話に一致した）。PostgreSQL の `LIKE` の既定のエスケープ文字
 * `\` を前に付ける。`\` 自身も先にエスケープする。
 *
 * @param term - キーワード
 * @returns `contains` に渡す値
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, '\\$&');
}

/**
 * キーワードのいずれかに一致する正規表現を作る（大文字・小文字を区別しない）。
 *
 * 長い語を先に並べ、`React` と `React Hooks` のように重なる語で長い方を優先する。
 *
 * @param terms - キーワード（1 つ以上）
 * @returns 全体を対象にする（`g`）正規表現
 */
function termsPattern(terms: string[]): RegExp {
  const alternatives = [...terms]
    .sort((a, b) => b.length - a.length)
    // 正規表現の記号を文字そのものとして扱う（`C++`・`a.b` 等のキーワードのため）
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(alternatives.join('|'), 'giu');
}

/**
 * 位置がサロゲートペア（絵文字等）の途中なら、ペアの外へずらす。
 *
 * @param text - 対象の文字列
 * @param index - 切り出しの位置
 * @param direction - ずらす向き（-1 で前、1 で後ろ）
 * @returns ペアを分断しない位置
 */
function avoidSurrogateSplit(
  text: string,
  index: number,
  direction: -1 | 1
): number {
  const code = text.charCodeAt(index);
  // 下位サロゲート（0xDC00〜0xDFFF）の位置で切ると、直前の上位サロゲートと分断される
  return code >= 0xdc00 && code <= 0xdfff ? index + direction : index;
}

/**
 * 本文から、最初にキーワードが現れた箇所の前後を切り出す（検索結果の抜粋）。
 *
 * 前後を {@link SNIPPET_RADIUS} 文字ずつ残し、途中で切った側に `…` を付ける。
 * 改行・連続する空白は 1 つの空白にまとめる（サイドバーの 1〜2 行に収めるため）。
 *
 * @param text - メッセージの本文
 * @param terms - キーワード（1 つ以上）
 * @returns 抜粋。どのキーワードも現れなければ `null`
 */
export function buildSnippet(text: string, terms: string[]): string | null {
  if (terms.length === 0) return null;
  const match = termsPattern(terms).exec(text);
  if (!match) return null;

  const start = avoidSurrogateSplit(
    text,
    Math.max(0, match.index - SNIPPET_RADIUS),
    1
  );
  const end = avoidSurrogateSplit(
    text,
    Math.min(text.length, match.index + match[0].length + SNIPPET_RADIUS),
    -1
  );
  const body = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`;
}

/**
 * 文字列を、キーワードに一致する片とそれ以外の片に分ける（強調表示用）。
 *
 * HTML を組み立てずに強調するため、表示側は `match` の片だけを `<mark>` で囲む。
 *
 * @param text - 対象の文字列（タイトル・抜粋）
 * @param terms - キーワード。空なら分割しない
 * @returns 元の順に並べた片。連結すると元の文字列に戻る
 */
export function splitHighlights(
  text: string,
  terms: string[]
): HighlightPart[] {
  if (terms.length === 0 || !text) return text ? [{ text, match: false }] : [];
  const parts: HighlightPart[] = [];
  let last = 0;
  for (const match of text.matchAll(termsPattern(terms))) {
    if (match.index > last) {
      parts.push({ text: text.slice(last, match.index), match: false });
    }
    parts.push({ text: match[0], match: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false });
  return parts;
}
