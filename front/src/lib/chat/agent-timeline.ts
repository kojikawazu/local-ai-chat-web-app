import type { ToolCallInfo } from '@/types/agent/tool-call';
import type {
  AgentTimeline,
  AgentTimelineStep,
} from '@/types/chat/agent-timeline';
import type { ResponseInstruction } from '@/types/chat/message';

/** 時系列に並べる 1 つ（ツールの呼び出しか、読まれた途中の指示）。並べ替えの鍵を持つ */
type TimelineEntry =
  | { kind: 'tool'; offset: number; order: number; call: ToolCallInfo }
  | { kind: 'instruction'; offset: number; order: number; content: string };

/**
 * エージェントの応答を、本文とツールの結果の時系列に並べ直す（#186）。
 *
 * ツール呼び出しの `contentOffset`（呼んだ時点の本文の文字数）で本文を区切り、
 * 「説明 → ツールの結果 → … → 回答」の順にする。同じ位置のツールは 1 つのまとまりにし、
 * 位置が同じなら渡した順を保つ。空白だけの説明は出さない。本文の長さを超える位置は末尾に寄せる。
 * 応答の途中で読まれた指示（#241）も、読んだ位置（`contentOffset`）に並べる。同じ位置のツールとの前後は、読んだ時点までに
 * 呼んだツールの数（`toolCallIndex`）で決める。読まれていない指示は時系列に入れない（呼び出し側が別に出す）。
 *
 * @param content - 応答の本文
 * @param toolCalls - ツール呼び出しの記録
 * @param instructions - 途中の指示（省略時は無し）
 * @returns 時系列。ツール呼び出しも読まれた指示も無い、または位置を持たないツール（#186 より前の保存）が 1 つでもあれば `null`
 *   （呼び出し側は本文 → ツールの一覧の従来の並びで出す）
 */
export function buildAgentTimeline(
  content: string,
  toolCalls: ToolCallInfo[],
  instructions: ResponseInstruction[] = []
): AgentTimeline | null {
  const read = instructions.filter(
    (instruction) => instruction.contentOffset !== undefined
  );
  if (toolCalls.length === 0 && read.length === 0) return null;
  if (toolCalls.some((call) => call.contentOffset === undefined)) return null;

  const clamp = (offset: number) => Math.min(offset, content.length);
  const entries: TimelineEntry[] = [
    ...toolCalls.map((call, index) => ({
      kind: 'tool' as const,
      offset: clamp(call.contentOffset ?? 0),
      order: index,
      call,
    })),
    ...read.map((instruction) => ({
      kind: 'instruction' as const,
      offset: clamp(instruction.contentOffset ?? 0),
      // 読んだ時点までに呼んだツールの後、次のツールの前に並べる
      order: (instruction.toolCallIndex ?? toolCalls.length) - 0.5,
      content: instruction.content,
    })),
  ];
  // sort は安定のため、同じ位置・同じ順の項目は渡した順のまま並ぶ
  entries.sort((a, b) => a.offset - b.offset || a.order - b.order);

  const steps: AgentTimelineStep[] = [];
  let cursor = 0;
  for (const entry of entries) {
    const last = steps.at(-1);
    if (
      entry.kind === 'tool' &&
      entry.offset === cursor &&
      last?.kind === 'tools'
    ) {
      last.toolCalls.push(entry.call);
      continue;
    }
    const text = content.slice(cursor, entry.offset);
    if (text.trim()) steps.push({ kind: 'text', text });
    steps.push(
      entry.kind === 'tool'
        ? { kind: 'tools', toolCalls: [entry.call] }
        : { kind: 'instruction', content: entry.content }
    );
    cursor = entry.offset;
  }

  const answer = content.slice(cursor);
  return { steps, answer: answer.trim() ? answer : '' };
}
