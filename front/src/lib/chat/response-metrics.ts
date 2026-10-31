import type { ResponseMetrics } from '@/types/chat/metrics';

/**
 * 応答のトークン数・所要時間の表示の文字列（#31。`docs/19-token-metrics.md`「表示」）。
 *
 * 要約（「312 トークン · 42.1 トークン/秒」）と、押して開く内訳の行を作る。
 */

/** モデルの読み込みの時間を内訳に出す下限（ミリ秒）。読み込み済みのモデルは数 ms のため、それは出さない */
const LOAD_SHOWN_MIN_MS = 500;

/** トークン数の 3 桁区切り */
const COUNT_FORMAT = new Intl.NumberFormat('ja-JP');

/** 内訳の 1 行。 */
export type MetricsDetailRow = {
  /** 項目名（`出力` 等） */
  label: string;
  /** 値の文字列 */
  value: string;
};

/**
 * トークン数を 3 桁ごとに区切る。
 *
 * @param count - トークン数
 * @returns `1,204` の形の文字列
 */
export function formatCount(count: number): string {
  return COUNT_FORMAT.format(Math.round(count));
}

/**
 * ミリ秒を 0.1 秒単位の秒にする。
 *
 * @param ms - ミリ秒
 * @returns `7.4 秒` の形の文字列
 */
export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} 秒`;
}

/**
 * 生成の速さ（トークン/秒）を出す。
 *
 * @param metrics - 応答のトークン数・所要時間
 * @returns トークン/秒。生成の時間が 0 なら `undefined`（割れないため出さない）
 */
export function tokensPerSecond(metrics: ResponseMetrics): number | undefined {
  if (metrics.outputDurationMs <= 0) return undefined;
  return metrics.outputTokens / (metrics.outputDurationMs / 1000);
}

/**
 * 応答の下に出す要約を作る。
 *
 * @param metrics - 応答のトークン数・所要時間
 * @returns `312 トークン · 42.1 トークン/秒` の形の文字列（速さを出せなければトークン数だけ）
 */
export function metricsSummary(metrics: ResponseMetrics): string {
  const tokens = `${formatCount(metrics.outputTokens)} トークン`;
  const speed = tokensPerSecond(metrics);
  return speed === undefined
    ? tokens
    : `${tokens} · ${speed.toFixed(1)} トークン/秒`;
}

/**
 * 押して開く内訳の行を作る。
 *
 * 最大の文脈は、複数の問い合わせ（エージェントのラウンド）を合計したときだけ出す（1 回なら入力と同じ）。
 * モデルの読み込みは {@link LOAD_SHOWN_MIN_MS} 以上のときだけ出す。
 *
 * @param metrics - 応答のトークン数・所要時間
 * @returns 内訳の行（表示の順）
 */
export function metricsDetails(metrics: ResponseMetrics): MetricsDetailRow[] {
  const cached =
    metrics.promptCachedTokens > 0
      ? `（キャッシュ ${formatCount(metrics.promptCachedTokens)}）`
      : '';
  return [
    { label: 'モデル', value: metrics.model },
    {
      label: '出力',
      value: `${formatCount(metrics.outputTokens)} トークン（思考を含む）・${formatSeconds(metrics.outputDurationMs)}`,
    },
    {
      label: '入力',
      value: `${formatCount(metrics.promptTokens)} トークン${cached}・${formatSeconds(metrics.promptDurationMs)}`,
    },
    ...(metrics.calls > 1
      ? [
          {
            label: '最大の文脈',
            value: `${formatCount(metrics.maxPromptTokens)} トークン`,
          },
        ]
      : []),
    ...(metrics.loadDurationMs >= LOAD_SHOWN_MIN_MS
      ? [
          {
            label: 'モデルの読み込み',
            value: formatSeconds(metrics.loadDurationMs),
          },
        ]
      : []),
    {
      label: 'Ollama の中の時間',
      value: formatSeconds(metrics.totalDurationMs),
    },
  ];
}
