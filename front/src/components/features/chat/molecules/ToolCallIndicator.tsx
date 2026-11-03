'use client';

import { Network } from 'lucide-react';
import {
  delegationRunningLabel,
  isDelegation,
  toolCallLabel,
} from '@/lib/chat/tool-label';
import { useElapsedSeconds } from '@/hooks/chat/useElapsedSeconds';

/** {@link ToolCallIndicator} の props。 */
interface ToolCallIndicatorProps {
  /** 実行中のツール名。{@link toolCallLabel} で日本語ラベルに変換して表示する（委譲のツールは任せた相手の名前。#26）。 */
  name: string;
  /** ツールに渡された引数。要約（各値を先頭 40 文字に切り詰め）して表示する。 */
  arguments: Record<string, unknown>;
}

/** 委譲のツールの実行中に出す、任せた仕事の先頭の文字数（1 行に収める） */
const TASK_PREVIEW_CHARS = 60;

/**
 * 実行中のスピナー。
 */
function Spinner() {
  return (
    <svg
      className="h-4 w-4 shrink-0 animate-spin text-[var(--color-nord-8)]"
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
  );
}

/**
 * サブエージェントに任せている間の表示（#26）。任せた相手・経過時間・任せた仕事の先頭を出す（数分かかるため、動いていることを見せる）。
 *
 * @param props - 委譲のツールの引数
 */
function DelegationIndicator({ args }: { args: Record<string, unknown> }) {
  const elapsed = useElapsedSeconds();
  const task = typeof args.task === 'string' ? args.task : '';
  const preview =
    Array.from(task).length > TASK_PREVIEW_CHARS
      ? `${Array.from(task).slice(0, TASK_PREVIEW_CHARS).join('')}…`
      : task;

  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-md border border-nord-frost-1/60 bg-nord-frost-1/10 px-3 py-2 text-sm text-[var(--color-nord-4)]"
    >
      <Spinner />
      <Network size={16} aria-hidden className="shrink-0 text-nord-frost-1" />
      <span className="shrink-0 font-medium text-nord-frost-1">
        {delegationRunningLabel(args)}…
      </span>
      {preview && (
        <span className="min-w-0 truncate opacity-70" title={task}>
          {preview}
        </span>
      )}
      <span className="ml-auto shrink-0 text-xs opacity-60">{elapsed} 秒</span>
    </div>
  );
}

/**
 * 実行中のツール呼び出しを示すインジケーター（スピナー付き）。
 *
 * ツール名を日本語ラベルに変換し、引数の要約を併記して「実行中...」を表示する。
 * サブエージェントに任せる委譲のツール（#26）は、サブエージェントのアイコンと色で「サブエージェントが Web を調べています…」・
 * 任せた仕事の先頭・経過時間を出す（ふつうのツールと見分けられるように）。
 *
 * @param props - 実行中ツールの名前と引数を持つ props
 */
export function ToolCallIndicator({
  name,
  arguments: args,
}: ToolCallIndicatorProps) {
  if (isDelegation(name)) return <DelegationIndicator args={args} />;

  const label = toolCallLabel(name, args);
  const argsSummary = Object.entries(args)
    .map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`)
    .join(', ');

  return (
    <div className="flex items-center gap-2 rounded-md border border-[var(--color-nord-3)] bg-[var(--color-nord-1)] px-3 py-2 text-sm text-[var(--color-nord-4)]">
      <Spinner />
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
