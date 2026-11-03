'use client';

import { LoaderCircle } from 'lucide-react';
import type { SubAgentRun, ToolCallInfo } from '@/types/agent/tool-call';
import { describeToolArguments, toolCallLabel } from '@/lib/chat/tool-label';

/** {@link SubAgentRunDetails} の props。 */
type SubAgentRunDetailsProps = {
  /** サブエージェントに任せた 1 回の記録（委譲のツールの記録の `subAgent`） */
  run: SubAgentRun;
};

/**
 * 中のツールの成否のアイコン（結果のパネルの見出しと同じ並び: 実行中のスピナー・失敗 ❌・空 ⚠️・成功 ✅）。
 *
 * @param props - 中のツールの記録
 */
function StepIcon({ step }: { step: ToolCallInfo }) {
  if (step.status) {
    return (
      <LoaderCircle
        size={14}
        aria-hidden
        className="shrink-0 animate-spin text-[var(--color-nord-8)]"
      />
    );
  }
  if (step.isError) return <span className="shrink-0 text-red-400">❌</span>;
  if (step.isEmpty) {
    return <span className="shrink-0 text-yellow-400">⚠️</span>;
  }
  return <span className="shrink-0 text-green-400">✅</span>;
}

/**
 * サブエージェントに任せた仕事と、サブエージェントの中の手順を出す（#26。`docs/29-multi-agent.md`「記録と画面」）。
 *
 * 委譲のツールの結果のパネル（`ToolCallResult`）を開いたときに、引数の代わりに出す。任せている間も、届いた中の手順を出す
 * （#26 Phase B。実行中の手順はスピナーで、開いても結果はまだ無い）。中の手順は 1 行ずつ
 * （成否・ツールの名前・対象・要約・所要時間）並べ、行を開くとそのツールの結果を出す。回答はパネルの結果の欄にある。
 *
 * @param props - サブエージェントの記録
 */
export function SubAgentRunDetails({ run }: SubAgentRunDetailsProps) {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-xs text-[var(--color-nord-4)] opacity-60 mb-1">
          任せた仕事
        </p>
        <p className="text-xs text-[var(--color-nord-4)] whitespace-pre-wrap break-words">
          {run.task}
        </p>
      </div>
      <div>
        <p className="text-xs text-[var(--color-nord-4)] opacity-60 mb-1">
          サブエージェントの手順（ツール {run.toolCalls.length} 回
          {/* 問い合わせの回数は終わってから届く。任せている間（0）は出さない（#26 Phase B） */}
          {run.rounds > 0 && `・問い合わせ ${run.rounds} 回`}）
        </p>
        {run.toolCalls.length === 0 ? (
          <p className="text-xs text-[var(--color-nord-4)]">
            ツールを使わずに答えました
          </p>
        ) : (
          <ol aria-label="サブエージェントの手順" className="space-y-1 text-xs">
            {run.toolCalls.map((step, index) => {
              const target = describeToolArguments(step.arguments);
              return (
                <li key={index}>
                  <details className="rounded border border-[var(--color-nord-3)]">
                    <summary className="flex cursor-pointer items-center gap-2 px-2 py-1 text-[var(--color-nord-4)] hover:bg-[var(--color-nord-2)]">
                      <StepIcon step={step} />
                      <span className="shrink-0 font-medium text-[var(--color-nord-8)]">
                        {toolCallLabel(step.name, step.arguments)}
                      </span>
                      {target && (
                        <span className="min-w-0 truncate" title={target}>
                          {target}
                        </span>
                      )}
                      {step.summary && (
                        <span
                          title={step.summary}
                          className={`min-w-0 truncate ${
                            step.isError ? 'text-red-400' : 'opacity-70'
                          }`}
                        >
                          {step.summary}
                        </span>
                      )}
                      {step.durationMs > 0 && (
                        <span className="ml-auto shrink-0 opacity-50">
                          ({step.durationMs}ms)
                        </span>
                      )}
                    </summary>
                    <pre
                      className={`max-h-64 overflow-auto border-t border-[var(--color-nord-3)] px-2 py-1 whitespace-pre-wrap break-all ${
                        step.isError
                          ? 'text-red-400'
                          : 'text-[var(--color-nord-4)]'
                      }`}
                    >
                      {step.status ? '（実行中）' : step.result || '(空の結果)'}
                    </pre>
                  </details>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
