import type { OllamaStreamChunk } from './ollama';
import type { ResponseMetrics } from '@/types/chat/metrics';

/**
 * Ollama の応答の終わりのチャンクから、トークン数・所要時間を集める（#31。`docs/19-token-metrics.md`「集める値」）。
 *
 * 通常のチャットの route とエージェントのループが、終わりのチャンクを受けるたびに使う。
 */

/** Ollama の時間（ナノ秒）をミリ秒にする割る数 */
const NS_PER_MS = 1_000_000;

/**
 * 0 以上の有限の数かを返す（Ollama の応答は外から届く値のため確かめる）。
 *
 * @param value - 確かめる値
 * @returns 0 以上の有限の数なら true
 */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * 数でなければ 0 にする（任意の値。届かない Ollama の版もある）。
 *
 * @param value - 値
 * @returns 0 以上の有限の数ならその値、それ以外は 0
 */
function countOrZero(value: unknown): number {
  return isCount(value) ? value : 0;
}

/**
 * ナノ秒をミリ秒にする（数でなければ 0）。
 *
 * @param value - ナノ秒
 * @returns ミリ秒
 */
function nsToMs(value: unknown): number {
  return countOrZero(value) / NS_PER_MS;
}

/**
 * 終わりのチャンク 1 つを、問い合わせ 1 回分の値にする。
 *
 * 出力のトークン数（`eval_count`）と生成の時間（`eval_duration`）が無い・数でないときは値を持たない
 * （速さを出せず、何の値か分からないため）。ほかの項目は無ければ 0 にする。
 *
 * @param chunk - Ollama の終わりのチャンク（`done: true`）
 * @returns 問い合わせ 1 回分の値。出力の値が無ければ `undefined`
 */
export function metricsFromDoneChunk(
  chunk: OllamaStreamChunk
): ResponseMetrics | undefined {
  if (!isCount(chunk.eval_count) || !isCount(chunk.eval_duration)) {
    return undefined;
  }
  const promptTokens = countOrZero(chunk.prompt_eval_count);
  return {
    model: typeof chunk.model === 'string' ? chunk.model : '',
    calls: 1,
    promptTokens,
    promptCachedTokens: countOrZero(chunk.prompt_eval_cached_count),
    maxPromptTokens: promptTokens,
    promptDurationMs: nsToMs(chunk.prompt_eval_duration),
    outputTokens: chunk.eval_count,
    outputDurationMs: nsToMs(chunk.eval_duration),
    loadDurationMs: nsToMs(chunk.load_duration),
    totalDurationMs: nsToMs(chunk.total_duration),
  };
}

/**
 * 2 つの値を合計する（エージェントのラウンドを足す）。
 *
 * トークン数・時間・問い合わせの数は足し、文脈の大きさは大きい方を取る。モデルは後の問い合わせのもの
 * （空なら前のもの）。片方が無ければもう片方をそのまま返す。
 *
 * @param total - それまでの合計（無ければ `undefined`）
 * @param next - 足す値（無ければ `undefined`）
 * @returns 合計。両方とも無ければ `undefined`
 */
export function addMetrics(
  total: ResponseMetrics | undefined,
  next: ResponseMetrics | undefined
): ResponseMetrics | undefined {
  if (!total) return next;
  if (!next) return total;
  return {
    model: next.model || total.model,
    calls: total.calls + next.calls,
    promptTokens: total.promptTokens + next.promptTokens,
    promptCachedTokens: total.promptCachedTokens + next.promptCachedTokens,
    maxPromptTokens: Math.max(total.maxPromptTokens, next.maxPromptTokens),
    promptDurationMs: total.promptDurationMs + next.promptDurationMs,
    outputTokens: total.outputTokens + next.outputTokens,
    outputDurationMs: total.outputDurationMs + next.outputDurationMs,
    loadDurationMs: total.loadDurationMs + next.loadDurationMs,
    totalDurationMs: total.totalDurationMs + next.totalDurationMs,
  };
}
