import type { ToolCallInfo, ToolCallStatus } from '@/types/agent/tool-call';
import type { Message } from '@/types/chat/message';
import type { ActiveToolCall } from '@/lib/chat/chat-state';
import { isSubAgentName } from '@/lib/chat/tool-label';

/** 結果の欄に入れる値。{@link finishToolCall} が受け取る */
type ToolCallOutcome = Pick<
  ToolCallInfo,
  | 'result'
  | 'isError'
  | 'summary'
  | 'isEmpty'
  | 'approval'
  | 'screenshots'
  | 'subAgent'
>;

/**
 * 結果の届いていない記録の位置を探す。
 *
 * 呼び出しの ID（`callId`。#26 Phase B）があれば ID で探す。無ければ、同じ名前のうち最初のもの
 * （サーバーは同じ名前のツールを呼んだ順に実行・承認・結果を返すため。ID の無いイベントへの保険）。
 *
 * @param toolCalls - ツール呼び出しの記録
 * @param name - ツール名
 * @param status - 探す状態。省略時は結果が届いていない（`status` を持つ）もの
 * @param callId - 呼び出しの ID。省略時は名前で探す
 * @returns 位置。無ければ -1
 */
function findPending(
  toolCalls: ToolCallInfo[],
  name: string,
  status?: ToolCallStatus,
  callId?: string
): number {
  return toolCalls.findIndex(
    (call) =>
      (callId !== undefined ? call.callId === callId : call.name === name) &&
      (status ? call.status === status : call.status !== undefined)
  );
}

/**
 * 結果の届いた記録から、生成中の画面だけが持つ印（状態・呼び出しの ID）を外す。
 *
 * @param call - 記録
 * @returns 印を外した記録
 */
function withoutProgress(call: ToolCallInfo): ToolCallInfo {
  // status・callId は分割代入で外す（結果が届いたら、実行中・承認待ちの表示をやめ、保存の形に戻す）
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { status, callId, ...rest } = call;
  return rest;
}

/**
 * 実行を始めたツールの仮の記録を足す（#192）。結果が届くまで `running`（順番待ちなら `queued`。#26 Phase B）として表示する。
 *
 * @param toolCalls - ツール呼び出しの記録
 * @param call - 呼んだツールの名前・引数・本文の位置・呼び出しの ID
 * @param queued - 同じ組の前の呼び出しを待つなら true
 * @returns 仮の記録を足した記録（元の配列は変えない）
 */
export function startToolCall(
  toolCalls: ToolCallInfo[],
  call: Pick<ToolCallInfo, 'name' | 'arguments' | 'contentOffset' | 'callId'>,
  queued = false
): ToolCallInfo[] {
  return [
    ...toolCalls,
    {
      ...call,
      result: '',
      isError: false,
      durationMs: 0,
      status: queued ? 'queued' : 'running',
    },
  ];
}

/**
 * ツールの状態を変える（#192）。承認の依頼が届いたら `awaiting-approval` に、許可・拒否を返したら `running` に戻す。
 * 順番待ちのツールが動き始めたら `queued` から `running` にする（#26 Phase B）。
 *
 * 対象は、呼び出しの ID（無ければ同じ名前）で `from` の状態にある最初の記録。無ければ何も変えない。
 *
 * @param toolCalls - ツール呼び出しの記録
 * @param name - ツール名
 * @param from - 今の状態
 * @param to - 変えた後の状態
 * @param callId - 呼び出しの ID。省略時は名前で探す
 * @returns 状態を変えた記録（変えなければ元の配列）
 */
export function updateToolCallStatus(
  toolCalls: ToolCallInfo[],
  name: string,
  from: ToolCallStatus,
  to: ToolCallStatus,
  callId?: string
): ToolCallInfo[] {
  const index = findPending(toolCalls, name, from, callId);
  if (index < 0) return toolCalls;
  return toolCalls.map((call, i) =>
    i === index ? { ...call, status: to } : call
  );
}

/**
 * ツールの結果を、その仮の記録に入れて状態と呼び出しの ID を消す（#192）。
 *
 * 対象は、呼び出しの ID（無ければ同じ名前）で結果が届いていない最初の記録。無ければ、同じ名前の最後の記録に入れる
 * （仮の記録を足す前に結果が届いた場合の保険。#192 より前の動きと同じ）。
 *
 * @param toolCalls - ツール呼び出しの記録
 * @param name - ツール名
 * @param outcome - 届いた結果
 * @param callId - 呼び出しの ID。省略時は名前で探す
 * @returns 結果を入れた記録（対象が無ければ元の配列）
 */
export function finishToolCall(
  toolCalls: ToolCallInfo[],
  name: string,
  outcome: ToolCallOutcome,
  callId?: string
): ToolCallInfo[] {
  const pending = findPending(toolCalls, name, undefined, callId);
  const index =
    pending >= 0
      ? pending
      : toolCalls.map((call) => call.name).lastIndexOf(name);
  if (index < 0) return toolCalls;
  return toolCalls.map((call, i) =>
    i === index ? { ...withoutProgress(call), ...outcome } : call
  );
}

/** {@link startSubAgentStep} が受け取る、中の手順の開始。 */
type SubAgentStepStart = {
  /** 中の手順の ID */
  stepId: string;
  /** 中のツール名 */
  name: string;
  /** 中のツールの引数 */
  arguments: Record<string, unknown>;
};

/**
 * サブエージェントに任せている委譲の記録に、中の手順の仮の記録を足す（#26 Phase B）。
 *
 * 委譲の記録に `subAgent` がまだ無ければ、委譲の引数（任せた相手・仕事）から作る。終わったら `done` の記録で置き換わる。
 *
 * @param toolCalls - ツール呼び出しの記録
 * @param callId - 委譲の呼び出しの ID
 * @param step - 中の手順の ID・ツール名・引数
 * @returns 足した記録。委譲の記録が無い・任せた相手が分からなければ元の配列
 */
export function startSubAgentStep(
  toolCalls: ToolCallInfo[],
  callId: string,
  step: SubAgentStepStart
): ToolCallInfo[] {
  const index = toolCalls.findIndex((call) => call.callId === callId);
  if (index < 0) return toolCalls;
  const delegation = toolCalls[index];
  const { agent, task } = delegation.arguments;
  const run =
    delegation.subAgent ??
    (isSubAgentName(agent)
      ? {
          agent,
          task: typeof task === 'string' ? task : '',
          toolCalls: [],
          rounds: 0,
        }
      : undefined);
  if (!run) return toolCalls;
  const updated: ToolCallInfo = {
    ...delegation,
    subAgent: {
      ...run,
      toolCalls: startToolCall(run.toolCalls, {
        name: step.name,
        arguments: step.arguments,
        callId: step.stepId,
      }),
    },
  };
  return toolCalls.map((call, i) => (i === index ? updated : call));
}

/**
 * 委譲の記録の、中の手順の仮の記録に結果を入れる（#26 Phase B）。
 *
 * @param toolCalls - ツール呼び出しの記録
 * @param callId - 委譲の呼び出しの ID
 * @param stepId - 中の手順の ID
 * @param outcome - 届いた結果と所要時間
 * @returns 結果を入れた記録。委譲の記録・中の手順が無ければ元の配列
 */
export function finishSubAgentStep(
  toolCalls: ToolCallInfo[],
  callId: string,
  stepId: string,
  outcome: ToolCallOutcome & Pick<ToolCallInfo, 'durationMs'>
): ToolCallInfo[] {
  const index = toolCalls.findIndex((call) => call.callId === callId);
  const run = index >= 0 ? toolCalls[index].subAgent : undefined;
  if (!run || !run.toolCalls.some((step) => step.callId === stepId)) {
    return toolCalls;
  }
  const updated: ToolCallInfo = {
    ...toolCalls[index],
    subAgent: {
      ...run,
      toolCalls: run.toolCalls.map((step) =>
        step.callId === stepId ? { ...withoutProgress(step), ...outcome } : step
      ),
    },
  };
  return toolCalls.map((call, i) => (i === index ? updated : call));
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

/**
 * メッセージの、まだ結果の届いていない最初のツールの呼び出しを返す（下の「実行中」の表示に出すもの。#26）。
 *
 * 同じ応答の中で順に実行するツール（サブエージェントへの委譲・ブラウザの操作）は、呼ばれた順に 1 つずつ動く。
 * 最後に始まったものを出すと、順番を待っているものを実行中と見せてしまうため、最初のものを出す。
 * 承認待ちのものも含める（承認カードが出ている間は、下の表示の代わりに承認カードが出る）。
 * サブエージェントに任せている委譲なら、中の今の手順（結果の届いていない最後の中の手順）も返す（#26 Phase B）。
 *
 * @param messages - メッセージ一覧
 * @param messageId - 対象のメッセージ ID
 * @returns 名前・引数（と中の今の手順）。結果の届いていないものが無ければ `null`
 */
export function firstPendingToolCall(
  messages: Message[],
  messageId: string
): ActiveToolCall | null {
  const toolCalls =
    messages.find((msg) => msg.id === messageId)?.metadata?.toolCalls ?? [];
  const pending = toolCalls.find((call) => call.status !== undefined);
  if (!pending) return null;
  const step = pending.subAgent?.toolCalls.findLast(
    (inner) => inner.status !== undefined
  );
  return {
    name: pending.name,
    arguments: pending.arguments,
    ...(step && {
      currentStep: { name: step.name, arguments: step.arguments },
    }),
  };
}
