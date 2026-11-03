import type {
  ScreenshotBox,
  SubAgentRun,
  ToolCallInfo,
  ToolScreenshot,
} from '@/types/agent/tool-call';
import { isSubAgentName } from '@/lib/chat/tool-label';
import type { Message } from '@/types/chat/message';
import type { ResponseMetrics } from '@/types/chat/metrics';
import type { KnowledgeSource } from '@/types/knowledge/document';
import { isValidUUID } from '@/lib/shared/validation';

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
 * 保存済みのスクリーンショットの、要素の位置を検証する（#200）。
 *
 * @param value - 保存済みの位置（外部入力）
 * @returns 左上が 0 以上・幅と高さが 0 より大きい有限な数なら位置、そうでなければ `undefined`
 */
function parseBox(value: unknown): ScreenshotBox | undefined {
  if (!isRecord(value)) return undefined;
  const { x, y, width, height } = value;
  if (
    !isNonNegativeNumber(x) ||
    !isNonNegativeNumber(y) ||
    !isNonNegativeNumber(width) ||
    !isNonNegativeNumber(height) ||
    width === 0 ||
    height === 0
  ) {
    return undefined;
  }
  return { x, y, width, height };
}

/**
 * 保存済みのスクリーンショット 1 枚を検証して {@link ToolScreenshot} に戻す（#200）。
 *
 * 中身（`data`）は保存しないため、あっても読まない（画像は添付画像の取得 API で表示する）。
 * 位置（`box`）は形が合うときだけ含める（枠を出せなくても、画像は出す）。
 *
 * @param value - 保存済みのスクリーンショット（外部入力）
 * @returns 復元したスクリーンショット。ID・種類・形式・大きさのどれかが不正なら `null`
 */
function parseScreenshot(value: unknown): ToolScreenshot | null {
  if (!isRecord(value)) return null;
  const { id, kind, mimeType, width, height, box } = value;
  if (
    typeof id !== 'string' ||
    !isValidUUID(id) ||
    (kind !== 'before' && kind !== 'after') ||
    (mimeType !== 'image/jpeg' && mimeType !== 'image/png') ||
    !isPositiveInteger(width) ||
    !isPositiveInteger(height)
  ) {
    return null;
  }
  const parsedBox = parseBox(box);
  return {
    id,
    kind,
    mimeType,
    width,
    height,
    ...(parsedBox && { box: parsedBox }),
  };
}

/** 応答のトークン数・所要時間のうち、0 以上の数の項目（`model`・`calls` 以外。#31） */
const METRICS_NUMBER_KEYS = [
  'promptTokens',
  'promptCachedTokens',
  'maxPromptTokens',
  'promptDurationMs',
  'outputTokens',
  'outputDurationMs',
  'loadDurationMs',
  'totalDurationMs',
] as const satisfies readonly (keyof ResponseMetrics)[];

/**
 * 保存済みの応答のトークン数・所要時間を検証する（#31。`docs/19-token-metrics.md`「保存と読み込み」）。
 *
 * 1 項目でも形が合わなければ全体を捨てる（一部だけの値では、速さや内訳が誤って見えるため）。
 *
 * @param value - 保存済みの値（外部入力）
 * @returns `model` が空でない文字列・`calls` が 1 以上の整数・ほかが 0 以上の有限な数なら値、そうでなければ `undefined`
 */
function parseMetrics(value: unknown): ResponseMetrics | undefined {
  if (!isRecord(value)) return undefined;
  const { model, calls } = value;
  if (typeof model !== 'string' || !model || !isPositiveInteger(calls)) {
    return undefined;
  }
  if (!METRICS_NUMBER_KEYS.every((key) => isNonNegativeNumber(value[key]))) {
    return undefined;
  }
  const numbers = Object.fromEntries(
    METRICS_NUMBER_KEYS.map((key) => [key, value[key]])
  ) as Omit<ResponseMetrics, 'model' | 'calls'>; // 上の every で、どのキーも 0 以上の数だと確かめた
  return { model, calls, ...numbers };
}

/**
 * 保存済みの出典 1 件を検証する（#17 Phase B）。
 *
 * @param value - 保存済みの出典（外部入力）
 * @returns 名前が空でない文字列・見出しと抜き出しが文字列・類似度が有限な数なら出典、そうでなければ `null`
 */
function parseKnowledgeSource(value: unknown): KnowledgeSource | null {
  if (!isRecord(value)) return null;
  const { documentName, heading, excerpt, similarity } = value;
  if (
    typeof documentName !== 'string' ||
    !documentName ||
    typeof heading !== 'string' ||
    typeof excerpt !== 'string' ||
    typeof similarity !== 'number' ||
    !Number.isFinite(similarity)
  ) {
    return null;
  }
  return { documentName, heading, excerpt, similarity };
}

/**
 * 保存済みのツール呼び出し 1 件を検証して {@link ToolCallInfo} に戻す。
 *
 * ツール名と結果が文字列なら有効とし、欠けた項目は既定値で補う（引数 `{}`・成功・所要時間 0）。
 * 項目が揃っていない古いデータでも、表示に必要な名前と結果があれば復元するため。
 * 要約（`summary`）と空の結果（`isEmpty`）は型が合うときだけ含める（#150 より前のデータは持たない）。
 * 本文の位置（`contentOffset`）も 0 以上の整数のときだけ含める（#186 より前のデータは持たない）。
 * スクリーンショット（`screenshots`。#200）は 1 枚ずつ検証し、形の合わないものを捨てる。
 * サブエージェントに任せた記録（`subAgent`。#26）は {@link parseSubAgentRun} で検証し、形が合わなければ捨てる
 * （中のツールの呼び出しの中の `subAgent` は見ない。サブエージェントは委譲しないため入れ子にならない）。
 *
 * @param value - 保存済みのツール呼び出し（外部入力）
 * @param nested - サブエージェントの中のツールの呼び出しなら true（`subAgent` を読まない）
 * @returns 復元したツール呼び出し。名前か結果が文字列でなければ `null`
 */
function parseToolCall(value: unknown, nested = false): ToolCallInfo | null {
  if (!isRecord(value)) return null;
  const {
    name,
    result,
    arguments: args,
    isError,
    summary,
    isEmpty,
    durationMs,
    contentOffset,
    screenshots,
    subAgent,
  } = value;
  if (typeof name !== 'string' || typeof result !== 'string') return null;
  const parsedSubAgent = nested ? undefined : parseSubAgentRun(subAgent);
  const parsedScreenshots = Array.isArray(screenshots)
    ? screenshots
        .map(parseScreenshot)
        .filter((shot): shot is ToolScreenshot => shot !== null)
    : [];
  return {
    name,
    result,
    arguments: isRecord(args) ? args : {},
    isError: typeof isError === 'boolean' ? isError : false,
    ...(typeof summary === 'string' && summary && { summary }),
    ...(isEmpty === true && { isEmpty: true }),
    durationMs: isNonNegativeNumber(durationMs) ? durationMs : 0,
    ...(Number.isSafeInteger(contentOffset) &&
      isNonNegativeNumber(contentOffset) && { contentOffset }),
    ...(parsedScreenshots.length > 0 && { screenshots: parsedScreenshots }),
    ...(parsedSubAgent && { subAgent: parsedSubAgent }),
  };
}

/**
 * 保存済みの、サブエージェントに任せた記録を検証する（#26）。
 *
 * 任せた相手が知っているサブエージェントの名前・任せた仕事が文字列・中のツールの呼び出しが配列なら有効とする。
 * 中のツールの呼び出しは 1 件ずつ検証し、形の合わないものを捨てる。問い合わせの回数・トークン数は形が合うときだけ使う。
 *
 * @param value - 保存済みの記録（外部入力）
 * @returns 復元した記録。形が合わなければ `undefined`
 */
function parseSubAgentRun(value: unknown): SubAgentRun | undefined {
  if (!isRecord(value)) return undefined;
  const { agent, task, toolCalls, rounds, metrics } = value;
  if (
    !isSubAgentName(agent) ||
    typeof task !== 'string' ||
    !Array.isArray(toolCalls)
  ) {
    return undefined;
  }
  const parsedMetrics = parseMetrics(metrics);
  return {
    agent,
    task,
    toolCalls: toolCalls
      .map((call) => parseToolCall(call, true))
      .filter((call): call is ToolCallInfo => call !== null),
    rounds: isPositiveInteger(rounds) ? rounds : 0,
    ...(parsedMetrics && { metrics: parsedMetrics }),
  };
}

/**
 * エージェント応答の付随情報から、表示と保存に使う metadata を組み立てる。
 *
 * 値のある項目だけを含める（空のツール呼び出し一覧・空の思考過程は含めない）。
 * ただしドキュメントの出典（`knowledgeSources`。#17 Phase B）は空の配列も含める（「探したが見つからなかった」を表すため）。
 * 表示用の state と保存 API へ渡す値を同じ関数で作り、片方だけ項目が欠けるのを防ぐ（#94）。
 *
 * @param fields - ツール呼び出し・思考過程・ラウンド数・所要時間・停止の有無・トークン数・ドキュメントの出典（いずれも任意）
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
    // 停止していない応答に false を持たせない（値の無い通常チャットの応答は metadata 自体を null に保つ）
    ...(fields.interrupted && { interrupted: true }),
    ...(fields.metrics && { metrics: fields.metrics }),
    ...(fields.knowledgeSources && {
      knowledgeSources: fields.knowledgeSources,
    }),
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
  const {
    toolCalls,
    thinkingText,
    agentRounds,
    agentDurationMs,
    interrupted,
    metrics,
    knowledgeSources,
  } = value;
  return buildMessageMetadata({
    toolCalls: Array.isArray(toolCalls)
      ? toolCalls
          .map((call) => parseToolCall(call))
          .filter((tc): tc is ToolCallInfo => tc !== null)
      : undefined,
    thinkingText: typeof thinkingText === 'string' ? thinkingText : undefined,
    agentRounds: isPositiveInteger(agentRounds) ? agentRounds : undefined,
    agentDurationMs: isNonNegativeNumber(agentDurationMs)
      ? agentDurationMs
      : undefined,
    interrupted: interrupted === true,
    metrics: parseMetrics(metrics),
    // 形の合わない出典だけを捨てる。配列でなければ「探さなかった」応答として扱う
    knowledgeSources: Array.isArray(knowledgeSources)
      ? knowledgeSources
          .map(parseKnowledgeSource)
          .filter((source): source is KnowledgeSource => source !== null)
      : undefined,
  });
}
