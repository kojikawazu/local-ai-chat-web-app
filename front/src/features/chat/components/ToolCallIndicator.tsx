'use client';

/** {@link ToolCallIndicator} の props。 */
interface ToolCallIndicatorProps {
  /** 実行中のツール名。{@link TOOL_LABELS} で日本語ラベルに変換して表示する。 */
  name: string;
  /** ツールに渡された引数。要約（各値を先頭 40 文字に切り詰め）して表示する。 */
  arguments: Record<string, unknown>;
}

import { TOOL_LABELS } from '../constants/toolLabels';

/**
 * 実行中のツール呼び出しを示すインジケーター（スピナー付き）。
 *
 * ツール名を日本語ラベルに変換し、引数の要約を併記して「実行中...」を表示する。
 *
 * @param props - 実行中ツールの名前と引数を持つ props
 */
export function ToolCallIndicator({ name, arguments: args }: ToolCallIndicatorProps) {
  const label = TOOL_LABELS[name] ?? name;
  const argsSummary = Object.entries(args)
    .map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`)
    .join(', ');

  return (
    <div className="flex items-center gap-2 rounded-md border border-[var(--color-nord-3)] bg-[var(--color-nord-1)] px-3 py-2 text-sm text-[var(--color-nord-4)]">
      {/* スピナー */}
      <svg
        className="h-4 w-4 animate-spin text-[var(--color-nord-8)]"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      <span className="font-medium text-[var(--color-nord-8)]">🔧 {label}</span>
      {argsSummary && (
        <span className="truncate text-[var(--color-nord-4)] opacity-70">
          ({argsSummary})
        </span>
      )}
      <span className="ml-auto text-xs opacity-50">実行中...</span>
    </div>
  );
}
