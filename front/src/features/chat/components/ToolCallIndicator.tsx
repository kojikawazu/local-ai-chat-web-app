'use client';

interface ToolCallIndicatorProps {
  name: string;
  arguments: Record<string, unknown>;
}

import { TOOL_LABELS } from '../constants/toolLabels';

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
