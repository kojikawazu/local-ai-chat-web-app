import type { ToolCallInfo } from '@/types/agent/tool-call';
import type {
  AgentTimeline,
  AgentTimelineStep,
} from '@/types/chat/agent-timeline';

/**
 * エージェントの応答を、本文とツールの結果の時系列に並べ直す（#186）。
 *
 * ツール呼び出しの `contentOffset`（呼んだ時点の本文の文字数）で本文を区切り、
 * 「説明 → ツールの結果 → … → 回答」の順にする。同じ位置のツールは 1 つのまとまりにし、
 * 位置が同じなら渡した順を保つ。空白だけの説明は出さない。本文の長さを超える位置は末尾に寄せる。
 *
 * @param content - 応答の本文
 * @param toolCalls - ツール呼び出しの記録
 * @returns 時系列。ツール呼び出しが無い、または位置を持たないもの（#186 より前の保存）が 1 つでもあれば `null`
 *   （呼び出し側は本文 → ツールの一覧の従来の並びで出す）
 */
export function buildAgentTimeline(
  content: string,
  toolCalls: ToolCallInfo[]
): AgentTimeline | null {
  if (toolCalls.length === 0) return null;
  if (toolCalls.some((call) => call.contentOffset === undefined)) return null;

  const clamp = (offset: number) => Math.min(offset, content.length);
  // sort は安定のため、同じ位置のツールは渡した順のまま並ぶ
  const ordered = [...toolCalls].sort(
    (a, b) => clamp(a.contentOffset ?? 0) - clamp(b.contentOffset ?? 0)
  );

  const steps: AgentTimelineStep[] = [];
  let cursor = 0;
  for (const call of ordered) {
    const offset = clamp(call.contentOffset ?? 0);
    const last = steps.at(-1);
    if (offset === cursor && last?.kind === 'tools') {
      last.toolCalls.push(call);
      continue;
    }
    const text = content.slice(cursor, offset);
    if (text.trim()) steps.push({ kind: 'text', text });
    steps.push({ kind: 'tools', toolCalls: [call] });
    cursor = offset;
  }

  const answer = content.slice(cursor);
  return { steps, answer: answer.trim() ? answer : '' };
}
