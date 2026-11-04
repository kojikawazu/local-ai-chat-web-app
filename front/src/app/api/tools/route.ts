import { NextResponse } from 'next/server';
import { getAllToolDefinitions, getTool } from '@/lib/agent/tools/index';
import { initializeTools } from '@/lib/agent/tools/registry';
import { availableSubAgents } from '@/lib/agent/sub-agents';
import { syncMcpTools } from '@/lib/agent/tools/mcp/sync';
import { SUB_AGENT_LABELS } from '@/constants/agent/sub-agent';
import type { SubAgentSummary } from '@/types/agent/sub-agent';

// ツールを登録（registry.ts で一元管理）
initializeTools();

/**
 * エージェントが利用可能なツールの一覧を取得する。
 *
 * 登録済みツール定義から名前・説明を抽出し、有効フラグ付きで返す。サブエージェントだけのツール（#26）は含めない。
 * 使えるサブエージェント（中で使うツールが登録されているもの。#26）と、MCP のサーバーの状態（#208。読むたびに接続し直す）も返す。
 *
 * @returns ツール情報の配列（`tools`。各要素は `name` / `description` / `enabled`）、使えるサブエージェント
 *   （`subAgents`。各要素は `name` / `label`）、MCP の接続の状態（`mcp`）を含む JSON
 */
export async function GET() {
  const mcp = await syncMcpTools();
  const definitions = getAllToolDefinitions();

  const tools = definitions.map((def) => ({
    name: def.function.name,
    description: def.function.description,
    enabled: true,
  }));
  const subAgents: SubAgentSummary[] = availableSubAgents(getTool).map(
    (agent) => ({ name: agent.name, label: SUB_AGENT_LABELS[agent.name] })
  );

  return NextResponse.json({ tools, subAgents, mcp });
}
