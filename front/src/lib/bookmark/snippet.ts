import { buildSnippet } from '@/lib/conversation/search';

// キーワードが無い（または本文に現れない）ときに、応答の先頭から残す文字数
const LEAD_SNIPPET_LENGTH = 120;

/**
 * ブックマークの一覧（#30）に出す、応答の抜粋を作る。
 *
 * キーワードが本文に現れれば、その前後を切り出す（会話の検索と同じ {@link buildSnippet}）。
 * キーワードが無い・メモやタイトルだけに一致したときは、先頭から {@link LEAD_SNIPPET_LENGTH} 文字を出す。
 * 改行・連続する空白は 1 つの空白にまとめる（一覧の 2 行に収めるため）。
 *
 * @param content - 応答の本文
 * @param terms - キーワード（無ければ空配列）
 * @returns 抜粋。途中で切った側には `…` を付ける。本文が空白だけなら空文字列
 */
export function buildBookmarkSnippet(content: string, terms: string[]): string {
  const matched = buildSnippet(content, terms);
  if (matched !== null) return matched;

  const collapsed = content.replace(/\s+/g, ' ').trim();
  // 文字列の長さはコードユニットで数えるため、配列にして絵文字等のサロゲートペアを分断しない
  const chars = Array.from(collapsed);
  if (chars.length <= LEAD_SNIPPET_LENGTH) return collapsed;
  return `${chars.slice(0, LEAD_SNIPPET_LENGTH).join('')}…`;
}
