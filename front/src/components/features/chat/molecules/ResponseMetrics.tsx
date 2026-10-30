'use client';

import { useId, useState } from 'react';
import { ChevronDown, Gauge } from 'lucide-react';
import type { ResponseMetrics as Metrics } from '@/types/chat/metrics';
import { metricsDetails, metricsSummary } from '@/lib/chat/response-metrics';
import { cn } from '@/lib/shared/class-names';

/** {@link ResponseMetrics} の props。 */
type ResponseMetricsProps = {
  /** 応答のトークン数・所要時間 */
  metrics: Metrics;
};

/**
 * 応答のトークン数・生成の速さの要約と、押して開く内訳（#31。`docs/19-token-metrics.md`「表示」）。
 *
 * 要約はボタン（`aria-expanded`）で、内訳はその下に開く（モーダルにしない）。
 * 折り返す横並びの中に置く前提で、内訳は `basis-full` で次の行に出す。
 *
 * @param props - 応答のトークン数・所要時間を持つ props
 */
export default function ResponseMetrics({ metrics }: ResponseMetricsProps) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1 opacity-60 hover:opacity-100 transition-opacity"
      >
        <Gauge size={12} aria-hidden />
        {metricsSummary(metrics)}
        <ChevronDown
          size={12}
          aria-hidden
          className={cn('transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <dl
          id={detailsId}
          aria-label="トークン数と所要時間の内訳"
          className="basis-full grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-nord-3 bg-nord-1 px-3 py-2"
        >
          {metricsDetails(metrics).map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-nord-4/60">{row.label}</dt>
              <dd className="text-nord-4/90 break-all">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}
