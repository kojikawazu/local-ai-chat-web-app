'use client';

import type { AgentTimelineStep } from '@/types/chat/agent-timeline';
import MarkdownContent from './MarkdownContent';
import { ToolCallResult } from './ToolCallResult';

/** {@link AgentSteps} の props。 */
type AgentStepsProps = {
  /** 回答より前の項目（`buildAgentTimeline` の `steps`） */
  steps: AgentTimelineStep[];
  /** 生成中の応答か。生成中は Mermaid の図を描かない（`MarkdownContent` と同じ扱い） */
  isStreaming: boolean;
};

/**
 * エージェントの応答のうち、回答より前の流れ（説明 → ツールの結果）を呼んだ順に並べる（#186）。
 *
 * 説明（ツールの前の一言）は吹き出しにせず、小さく薄い文字で出して回答と見分けられるようにする。
 * ツールの結果は同じ位置で呼んだものをまとめて並べる。回答は呼び出し側（`ChatWindow`）が吹き出しで出す。
 *
 * @param props - 並べる項目と生成中かを持つ props
 */
export default function AgentSteps({ steps, isStreaming }: AgentStepsProps) {
  return (
    <div className="space-y-2">
      {steps.map((step, index) =>
        step.kind === 'text' ? (
          <div key={index} data-testid="agent-step-text" className="px-2">
            <MarkdownContent
              content={step.text}
              isStreaming={isStreaming}
              size="compact"
            />
          </div>
        ) : (
          <div key={index} className="space-y-1">
            {step.toolCalls.map((toolCall, callIndex) => (
              <ToolCallResult key={callIndex} toolCall={toolCall} />
            ))}
          </div>
        )
      )}
    </div>
  );
}
