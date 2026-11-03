import {
  DELEGATE_TOOL_NAME,
  MAX_DELEGATIONS_PER_RESPONSE,
  DELEGATE_TOOL_TIMEOUT_MS,
} from '@/constants/agent/sub-agent';
import { runSubAgent } from '../../sub-agent-loop';
import type { SubAgentDefinition } from '../../sub-agents';
import {
  delegateDescription,
  delegationOutput,
  findSubAgent,
  parseDelegateArgs,
} from '../../sub-agents';
import { toolError } from '../output';
import type { Tool } from '../types';

/** 応答ごとの文脈（`ToolContext.scope`）に置く、この応答で委譲した回数のキー */
const DELEGATIONS_KEY = 'sub-agent:delegations';

/**
 * 調べもの・読みものをサブエージェントに任せるツールを作る（#26。`docs/29-multi-agent.md`「委譲のツール」）。
 *
 * サブエージェントは自分のシステムプロンプトとツールで独立したループを回し（{@link runSubAgent}）、まとめた回答だけを返す。
 * `access` は任せる相手で決まり、今のループの止める規則（手元を読んだ後は外部と通信しない。#148）がそのまま当たる。
 * Ollama は手元の 1 つのため、同じ応答の委譲は 1 つずつ実行する（`exclusive`）。1 回の応答で
 * {@link MAX_DELEGATIONS_PER_RESPONSE} 回まで。
 *
 * @param agents - 使えるサブエージェント（1 つ以上。`availableSubAgents` の結果）
 * @returns `delegate_to_agent` のツール
 */
export function createDelegateTool(
  agents: readonly SubAgentDefinition[]
): Tool {
  return {
    // 知らない相手は外部と通信するものとして扱う（手元を読んだ後なら止め、検証の失敗を返すまでもなく実行しない）
    access: (args) => findSubAgent(args.agent, agents)?.access ?? 'network',
    exclusive: 'sub-agent',
    timeoutMs: DELEGATE_TOOL_TIMEOUT_MS,
    definition: {
      name: DELEGATE_TOOL_NAME,
      description: delegateDescription(agents),
      parameters: {
        type: 'object',
        properties: {
          agent: {
            type: 'string',
            description: agents
              .map((agent) => `${agent.name}: ${agent.description}`)
              .join(' / '),
            enum: agents.map((agent) => agent.name),
          },
          task: {
            type: 'string',
            description:
              '任せる仕事。この会話を見ない相手にも分かるよう、何をどこまで調べ、何を返してほしいかを書く',
          },
        },
        required: ['agent', 'task'],
      },
    },
    async execute(args, signal, context) {
      const parsed = parseDelegateArgs(args, agents);
      if (!parsed.ok) return toolError(parsed.error);
      if (!context) {
        return toolError('サブエージェントは応答の中でしか動かせません');
      }
      const count = context.scope.get(DELEGATIONS_KEY);
      const delegated = typeof count === 'number' ? count : 0;
      if (delegated >= MAX_DELEGATIONS_PER_RESPONSE) {
        return toolError(
          `この応答ではこれ以上任せられません（${MAX_DELEGATIONS_PER_RESPONSE} 回まで）。ここまでの結果で答えてください`
        );
      }
      context.scope.set(DELEGATIONS_KEY, delegated + 1);

      const run = await runSubAgent({
        definition: parsed.agent,
        task: parsed.task,
        model: context.model,
        signal,
        context,
      });
      return delegationOutput(parsed.agent, parsed.task, run);
    },
  };
}
