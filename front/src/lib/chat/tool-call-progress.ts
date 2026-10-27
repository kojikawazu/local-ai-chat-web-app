import type { ToolCallInfo, ToolCallStatus } from '@/types/agent/tool-call';
import type { Message } from '@/types/chat/message';

/** 結果の欄に入れる値。{@link finishToolCall} が受け取る */
type ToolCallOutcome = Pick<
  ToolCallInfo,
  'result' | 'isError' | 'summary' | 'isEmpty' | 'approval'
>;

/**
 * 同じ名前のツールのうち、指定した状態の最初の記録の位置を探す。
 *
 * サーバーは同じ名前のツールを呼んだ順に実行・承認・結果を返すため、最初のものが対象になる。
 *
 * @param toolCalls - ツール呼び出しの記録
 * @param name - ツール名
 * @param status - 探す状態。省略時は結果が届いていない（`status` を持つ）もの
 * @returns 位置。無ければ -1
 */
function findPending(
  toolCalls: ToolCallInfo[],
  name: string,
  status?: ToolCallStatus
): number {
  return toolCalls.findIndex(
    (call) =>
      call.name === name &&
      (status ? call.status === status : call.status !== undefined)
  );
}

/**
 * 実行を始めたツールの仮の記録を足す（#192）。結果が届くまで `running` として表示する。
 *
 * @param toolCalls - ツール呼び出しの記録
 * @param call - 呼んだツールの名前・引数・本文の位置
 * @returns 仮の記録を足した記録（元の配列は変えない）
 */
export function startToolCall(
  toolCalls: ToolCallInfo[],
  call: Pick<ToolCallInfo, 'name' | 'arguments' | 'contentOffset'>
): ToolCallInfo[] {
  return [
    ...toolCalls,
    {
      ...call,
      result: '',
      isError: false,
      durationMs: 0,
      status: 'running',
    },
  ];
}

/**
 * ツールの状態を変える（#192）。承認の依頼が届いたら `awaiting-approval` に、許可・拒否を返したら `running` に戻す。
 *
 * 対象は、同じ名前で `from` の状態にある最初の記録。無ければ何も変えない。
 *
 * @param toolCalls - ツール呼び出しの記録
 * @param name - ツール名
 * @param from - 今の状態
 * @param to - 変えた後の状態
 * @returns 状態を変えた記録（変えなければ元の配列）
 */
export function updateToolCallStatus(
  toolCalls: ToolCallInfo[],
  name: string,
  from: ToolCallStatus,
  to: ToolCallStatus
): ToolCallInfo[] {
  const index = findPending(toolCalls, name, from);
  if (index < 0) return toolCalls;
  return toolCalls.map((call, i) =>
    i === index ? { ...call, status: to } : call
  );
}

/**
 * ツールの結果を、その仮の記録に入れて状態を消す（#192）。
 *
 * 対象は、同じ名前で結果が届いていない最初の記録。無ければ、同じ名前の最後の記録に入れる
 * （仮の記録を足す前に結果が届いた場合の保険。#192 より前の動きと同じ）。
 *
 * @param toolCalls - ツール呼び出しの記録
 * @param name - ツール名
 * @param outcome - 届いた結果
 * @returns 結果を入れた記録（対象が無ければ元の配列）
 */
export function finishToolCall(
  toolCalls: ToolCallInfo[],
  name: string,
  outcome: ToolCallOutcome
): ToolCallInfo[] {
  const pending = findPending(toolCalls, name);
  const index =
    pending >= 0
      ? pending
      : toolCalls.map((call) => call.name).lastIndexOf(name);
  if (index < 0) return toolCalls;
  return toolCalls.map((call, i) => {
    if (i !== index) return call;
    // status は分割代入で外す（結果が届いたら、実行中・承認待ちの表示をやめる）
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { status, ...rest } = call;
    return { ...rest, ...outcome };
  });
}

/**
 * メッセージ一覧のうち 1 つのメッセージの、ツール呼び出しの記録を差し替える（#192）。
 *
 * @param messages - メッセージ一覧
 * @param messageId - 対象のメッセージ ID
 * @param update - 今の記録から新しい記録を作る関数（記録が無ければ空配列を受け取る）
 * @returns 差し替えた一覧（元の配列は変えない）
 */
export function updateMessageToolCalls(
  messages: Message[],
  messageId: string,
  update: (toolCalls: ToolCallInfo[]) => ToolCallInfo[]
): Message[] {
  return messages.map((msg) =>
    msg.id === messageId
      ? {
          ...msg,
          metadata: {
            ...msg.metadata,
            toolCalls: update(msg.metadata?.toolCalls ?? []),
          },
        }
      : msg
  );
}
