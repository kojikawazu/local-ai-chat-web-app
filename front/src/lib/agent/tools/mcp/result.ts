import type { ToolOutput } from '../types';
import { toolError } from '../output';

/** モデルへ返す結果の長さの上限（文字）。`read_file` と同じ */
const MAX_RESULT_CHARS = 12_000;

/** 文章にしない内容の種類ごとの置き換え */
const OMITTED_LABELS: Record<string, string> = {
  image: '（画像を省きました）',
  audio: '（音声を省きました）',
  resource: '（リソースを省きました）',
  resource_link: '（リソースへのリンクを省きました）',
};

/**
 * 値がオブジェクト（配列・`null` を除く）かを判定する。
 *
 * @param value - 調べる値
 * @returns オブジェクトなら true
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 結果の `content` の 1 つを文章にする。
 *
 * @param item - `content` の要素
 * @returns 文章
 */
function contentToText(item: unknown): string {
  if (!isRecord(item)) return '';
  if (item.type === 'text' && typeof item.text === 'string') return item.text;
  return typeof item.type === 'string'
    ? (OMITTED_LABELS[item.type] ?? `（${item.type} を省きました）`)
    : '';
}

/**
 * MCP のツールの結果を、エージェントのツールの結果にする（#208）。
 *
 * 外部の入力のため `unknown` で受ける。`text` をつなぎ、画像等は省いたことを文章で伝える。`content` が空で `structuredContent` があれば JSON にする。
 * {@link MAX_RESULT_CHARS} 字で切る。
 *
 * @param result - `client.callTool` の結果
 * @returns モデルへ返す結果
 */
export function convertMcpResult(result: unknown): ToolOutput {
  const record = isRecord(result) ? result : {};
  const content = Array.isArray(record.content) ? record.content : [];
  const parts = content.map(contentToText).filter((text) => text !== '');
  const text =
    parts.length > 0
      ? parts.join('\n')
      : record.structuredContent !== undefined
        ? JSON.stringify(record.structuredContent)
        : '';
  if (record.isError === true) {
    return toolError(text || 'MCP のツールが失敗しました');
  }
  if (text === '')
    return { result: '（結果は空でした）', isError: false, isEmpty: true };
  return {
    isError: false,
    result:
      text.length > MAX_RESULT_CHARS
        ? `${text.slice(0, MAX_RESULT_CHARS)}\n…（長いため ${MAX_RESULT_CHARS} 文字で切りました）`
        : text,
  };
}
