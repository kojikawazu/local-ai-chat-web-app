import type { OllamaChatMessage } from '@/lib/llm/ollama';
import { streamChat } from '@/lib/llm/ollama';
import { addMetrics } from '@/lib/llm/metrics';
import { getLocalTimeZone, withCurrentDate } from '@/lib/llm/current-date';
import {
  SUB_AGENT_ANSWER_BY_MS,
  SUB_AGENT_MAX_ROUNDS,
  SUB_AGENT_TIMEOUT_MS,
} from '@/constants/agent/sub-agent';
import type { ToolCallInfo } from '@/types/agent/tool-call';
import type { ResponseMetrics } from '@/types/chat/metrics';
import {
  createInOrderQueue,
  executeToolCall,
  readOllamaResponse,
} from './agent';
import type { ToolCallState } from './agent';
import type { SubAgentDefinition, SubAgentResult } from './sub-agents';
import { subAgentToolNames } from './sub-agents';
import { getTool, getToolDefinitionsByName } from './tools/index';
import type { ToolContext } from './tools/types';

/**
 * ラウンドの上限・時間に達した後の最終回答で、履歴の末尾に足す指示（user の発言として渡す。メインの `FINAL_ANSWER_INSTRUCTION` と同じ理由）
 */
export const SUB_AGENT_FINAL_INSTRUCTION =
  'これ以上ツールは呼べません。ここまでに得た情報だけで、任された仕事に答えてください。足りない点・調べきれなかった点は、その旨を書いてください。';

/** {@link runSubAgent} の引数。 */
type RunSubAgentParams = {
  /** 任せるサブエージェント */
  definition: SubAgentDefinition;
  /** 任せる仕事（メインのモデルが書いた `task`） */
  task: string;
  /** 問い合わせるモデル（メインと同じ。未指定なら既定のモデル） */
  model?: string;
  /** 委譲のツールの signal（時間の上限・停止・切断）。サブエージェントの問い合わせと中のツールまで止める */
  signal: AbortSignal;
  /** メインの応答の文脈。後始末の登録はメインへつなぎ、手元を読んだかはメインの値から始める */
  context: ToolContext;
};

/**
 * サブエージェントのエージェントループを回し、最終回答と記録を返す（#26。`docs/29-multi-agent.md`「ループの共通化」）。
 *
 * 会話はサブエージェントのシステムプロンプト（後ろに現在の日時）と任せた仕事だけで始める（メインの会話の履歴は渡さない）。
 * 本文はストリームに流さずに集め、最後のラウンドの本文を回答にする（ツールの前の一言を回答に混ぜない）。思考過程は捨てる。
 * ツールの実行は、メインと同じ {@link executeToolCall}（止める規則・時間の上限）を通す。承認が要るツールは実行しない。
 * {@link SUB_AGENT_MAX_ROUNDS} に達したら、または {@link SUB_AGENT_ANSWER_BY_MS} を過ぎたら（途中の問い合わせ・中のツールも止めて）、
 * ツールを渡さず思考させずにもう 1 回問い合わせて最終回答を作らせる。最終回答も {@link SUB_AGENT_TIMEOUT_MS} で止め、
 * そのときは調べた分の記録と理由を返す（委譲のツールの時間の上限で打ち切られると、記録も回答も失われるため）。
 *
 * @param params - 任せる相手・仕事・モデル・signal・メインの文脈
 * @returns 回答・中のツールの呼び出し・ラウンド数・トークン数。Ollama に問い合わせられなければ `error` に理由
 * @throws {Error} 停止・切断・時間切れで `signal` が中断された場合（受け取る相手がいないため、結果にしない）
 */
export async function runSubAgent({
  definition,
  task,
  model,
  signal,
  context,
}: RunSubAgentParams): Promise<SubAgentResult> {
  const tools = getToolDefinitionsByName(
    subAgentToolNames(definition, getTool)
  );
  const history: OllamaChatMessage[] = [
    {
      role: 'system',
      // 現在の日時を必ず知らせる。任せる仕事の文にモデルの知識の古い年が入ることがある（docs/29「前提の調査」）
      content: withCurrentDate(definition.systemPrompt, {
        now: new Date(),
        timeZone: getLocalTimeZone(),
        enableTools: true,
      }),
    },
    { role: 'user', content: task },
  ];
  const toolCalls: ToolCallInfo[] = [];
  let metrics: ResponseMetrics | undefined;
  let rounds = 0;
  // 手元を読んだかはメインの値から始める（researcher はメインが手元を読む前にしか動かない。docs/29「外部への持ち出し」）
  let hasReadLocal = context.hasReadLocal();
  const innerContext: ToolContext = {
    appOrigin: context.appOrigin,
    model,
    scope: new Map(),
    onDispose: context.onDispose,
    hasReadLocal: () => hasReadLocal,
  };
  // まとめ始める時間（ラウンドの問い合わせと中のツールを止める）と、サブエージェント全体の時間の上限（最終回答も止める）。
  // 委譲のツールの時間の上限（withToolTimeout）より先に自分で止め、調べた分の記録を返す
  const answerBy = AbortSignal.any([
    signal,
    AbortSignal.timeout(SUB_AGENT_ANSWER_BY_MS),
  ]);
  const deadline = AbortSignal.any([
    signal,
    AbortSignal.timeout(SUB_AGENT_TIMEOUT_MS),
  ]);
  const state: ToolCallState = {
    offered: new Set(tools.map((tool) => tool.function.name)),
    // 画像のツールは渡さない（subAgentToolNames）
    vision: false,
    unavailableTools: new Map(),
    hasReadLocal: () => hasReadLocal,
    markReadLocal: () => {
      hasReadLocal = true;
    },
    // ツールも、まとめ始める時間で止める（読みかけのページを待たずに答えさせる）
    signal: answerBy,
    context: innerContext,
  };
  const inOrder = createInOrderQueue();

  /**
   * 今の履歴で 1 回問い合わせ、本文とツールの呼び出しを返す。
   *
   * @param withTools - ツールを渡すか。上限に達した後の最終回答では渡さず、思考もさせない（早くまとめさせる）
   * @param roundSignal - この問い合わせを止める signal
   * @returns このラウンドの本文と、呼ばれたツール
   */
  const ask = async (withTools: boolean, roundSignal: AbortSignal) => {
    rounds++;
    const response = await streamChat(
      history,
      model,
      withTools ? tools : undefined,
      { signal: roundSignal, ...(!withTools && { think: false }) }
    );
    let text = '';
    const read = await readOllamaResponse(
      response,
      (chunk) => {
        text += chunk;
      },
      () => {}
    );
    metrics = addMetrics(metrics, read.metrics);
    return { text: text.trim(), toolCalls: read.toolCalls };
  };

  const result = (answer: string): SubAgentResult => ({
    answer,
    toolCalls,
    rounds,
    ...(metrics && { metrics }),
  });
  // 上限に達して最終回答を作らせた理由（ラウンド・時間）。上限に達せずに答えたら持たない
  let limit: SubAgentResult['limit'] = 'rounds';

  try {
    for (let round = 0; round < SUB_AGENT_MAX_ROUNDS; round++) {
      if (answerBy.aborted) {
        limit = 'time';
        break;
      }
      let reply: Awaited<ReturnType<typeof ask>>;
      try {
        reply = await ask(true, answerBy);
      } catch (error) {
        // まとめ始める時間で問い合わせを止めた。ここまでの履歴で答えさせる（この問い合わせは履歴に入れていない）
        if (!signal.aborted && answerBy.aborted) {
          limit = 'time';
          break;
        }
        throw error;
      }
      if (reply.toolCalls.length === 0) return result(reply.text);

      history.push({
        role: 'assistant',
        content: '',
        tool_calls: reply.toolCalls,
      });
      // 中のツールは、まとめ始める時間で止めると失敗の結果を返す（例外にならない）。履歴の対応は崩れない
      const outcomes = await Promise.all(
        reply.toolCalls.map((call) =>
          inOrder(getTool(call.function.name)?.exclusive, async () => {
            const { name, arguments: args } = call.function;
            const outcome = await executeToolCall(name, args, state);
            toolCalls.push({
              name,
              arguments: args,
              ...outcome.output,
              durationMs: outcome.durationMs,
            });
            return outcome;
          })
        )
      );
      // tool ロールのメッセージは呼び出しの順で足す（Promise.all は渡した順で返す）
      for (const outcome of outcomes) {
        history.push({ role: 'tool', content: outcome.output.result });
      }
    }

    history.push({ role: 'user', content: SUB_AGENT_FINAL_INSTRUCTION });
    try {
      return { ...result((await ask(false, deadline)).text), limit };
    } catch (error) {
      if (!signal.aborted && deadline.aborted) {
        return {
          ...result(''),
          limit,
          error: `まとめる前に時間の上限（${SUB_AGENT_TIMEOUT_MS / 1000} 秒）に達しました`,
        };
      }
      throw error;
    }
  } catch (error) {
    // 停止・切断・委譲のツールの時間切れ。受け取る相手がいない、または withToolTimeout が結果を作る
    if (signal.aborted) throw error;
    return {
      ...result(''),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
