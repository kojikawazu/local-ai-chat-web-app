/**
 * サブエージェントの名前（#26。定義は `lib/agent/sub-agents.ts`、設計は `docs/29-multi-agent.md`）。
 * 並びは委譲のツール（`delegate_to_agent`）の `agent` の選択肢の順。
 */
export const SUB_AGENT_NAMES = ['researcher', 'reader'] as const;

/** サブエージェントの名前（{@link SUB_AGENT_NAMES} の 1 つ） */
export type SubAgentName = (typeof SUB_AGENT_NAMES)[number];

/**
 * 画面に出す、使えるサブエージェント（`/api/tools` の `subAgents`）。
 */
export type SubAgentSummary = {
  /** 名前（委譲のツールの `agent` に渡す値） */
  name: SubAgentName;
  /** 表示名 */
  label: string;
};
