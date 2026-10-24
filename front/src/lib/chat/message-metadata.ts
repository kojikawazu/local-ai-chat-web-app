import type { ToolCallInfo } from '@/types/agent/tool-call';
import type { Message } from '@/types/chat/message';

/** メッセージに付く metadata（`null` を除いた形）。 */
type MessageMetadata = NonNullable<Message['metadata']>;

/**
 * 値がオブジェクト（配列・`null` を除く）かを判定する。
 *
 * @param value - 判定する値
 * @returns オブジェクトなら true
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 値が 0 以上の有限な数かを判定する。
 *
 * @param value - 判定する値
 * @returns 0 以上の有限な数なら true
 */
function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * 値が 1 以上の整数かを判定する。
 *
 * @param value - 判定する値
 * @returns 1 以上の整数なら true
 */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/**
 * 保存済みのツール呼び出し 1 件を検証して {@link ToolCallInfo} に戻す。
 *
 * ツール名と結果が文字列なら有効とし、欠けた項目は既定値で補う（引数 `{}`・成功・所要時間 0）。
 * 項目が揃っていない古いデータでも、表示に必要な名前と結果があれば復元するため。
 * 要約（`summary`）と空の結果（`isEmpty`）は型が合うときだけ含める（#150 より前のデータは持たない）。
 *
 * @param value - 保存済みのツール呼び出し（外部入力）
 * @returns 復元したツール呼び出し。名前か結果が文字列でなければ `null`
 */
function parseToolCall(value: unknown): ToolCallInfo | null {
  if (!isRecord(value)) return null;
  const {
    name,
    result,
    arguments: args,
    isError,
    summary,
    isEmpty,
    durationMs,
  } = value;
  if (typeof name !== 'string' || typeof result !== 'string') return null;
  return {
    name,
    result,
    arguments: isRecord(args) ? args : {},
    isError: typeof isError === 'boolean' ? isError : false,
    ...(typeof summary === 'string' && summary && { summary }),
    ...(isEmpty === true && { isEmpty: true }),
    durationMs: isNonNegativeNumber(durationMs) ? durationMs : 0,
  };
}

/**
 * エージェント応答の付随情報から、表示と保存に使う metadata を組み立てる。
 *
 * 値のある項目だけを含める（空のツール呼び出し一覧・空の思考過程は含めない）。
 * 表示用の state と保存 API へ渡す値を同じ関数で作り、片方だけ項目が欠けるのを防ぐ（#94）。
 *
 * @param fields - ツール呼び出し・思考過程・ラウンド数・所要時間・停止の有無（いずれも任意）
 * @returns 組み立てた metadata。値のある項目が 1 つも無ければ `null`（通常チャットの応答など）
 */
export function buildMessageMetadata(
  fields: MessageMetadata
): MessageMetadata | null {
  const metadata: MessageMetadata = {
    ...(fields.toolCalls &&
      fields.toolCalls.length > 0 && { toolCalls: fields.toolCalls }),
    ...(fields.thinkingText && { thinkingText: fields.thinkingText }),
    ...(fields.agentRounds !== undefined && {
      agentRounds: fields.agentRounds,
    }),
    ...(fields.agentDurationMs !== undefined && {
      agentDurationMs: fields.agentDurationMs,
    }),
    // 停止していない応答に false を持たせない（通常チャットの応答は metadata 自体を null に保つ）
    ...(fields.interrupted && { interrupted: true }),
  };
  return Object.keys(metadata).length > 0 ? metadata : null;
}

/**
 * API から取得した metadata を実行時に検証し、{@link Message} の metadata に戻す。
 *
 * DB の `metadata` 列は任意の JSON を持てるため、型を信用せず項目ごとに確かめる。
 * 型が合わない項目だけを捨て、残りは復元する（1 項目の不正で思考過程や統計まで失わないため）。
 *
 * @param value - API から取得した metadata（外部入力）
 * @returns 復元した metadata。オブジェクトでない、または有効な項目が 1 つも無ければ `null`
 */
export function parseMessageMetadata(value: unknown): MessageMetadata | null {
  if (!isRecord(value)) return null;
  const { toolCalls, thinkingText, agentRounds, agentDurationMs, interrupted } =
    value;
  return buildMessageMetadata({
    toolCalls: Array.isArray(toolCalls)
      ? toolCalls
          .map(parseToolCall)
          .filter((tc): tc is ToolCallInfo => tc !== null)
      : undefined,
    thinkingText: typeof thinkingText === 'string' ? thinkingText : undefined,
    agentRounds: isPositiveInteger(agentRounds) ? agentRounds : undefined,
    agentDurationMs: isNonNegativeNumber(agentDurationMs)
      ? agentDurationMs
      : undefined,
    interrupted: interrupted === true,
  });
}
