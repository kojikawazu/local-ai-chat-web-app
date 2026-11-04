import { MCP_TOOL_PREFIX } from '@/constants/agent/mcp';
import type { McpServerStatus, McpStatus } from '@/types/agent/mcp';
import { replaceToolsByPrefix } from '../index';
import { ensureMcpConnections } from './connections';
import { selectMcpTools } from './naming';
import { createMcpTool } from './tool';

/** モデルへ渡す MCP のツールの上限（全サーバーの合計）。測った値ではなく最初の目安（`docs/31-mcp-client.md` の M8） */
const MAX_MCP_TOOLS = 40;

/**
 * MCP のサーバーへ接続し、ツールをレジストリへ反映する（#208）。応答の始めと状態の表示で呼ぶ。
 *
 * レジストリはモジュールの変数で route ごとに別になりうるため、接続は共有し（`connections.ts`）、反映はそれぞれのモジュールで行う。
 * 失敗しても例外にせず、応答を止めない。
 *
 * @returns 接続の状態。未設定なら `servers` は空
 */
export async function syncMcpTools(): Promise<McpStatus> {
  try {
    const current = await ensureMcpConnections();
    if (!current) {
      replaceToolsByPrefix(MCP_TOOL_PREFIX, []);
      return { servers: [] };
    }
    const { config, connections } = current;
    const { selected, omitted } = selectMcpTools(
      connections.map((connection) => ({
        server: connection.config.name,
        tools: connection.tools,
        allow: connection.config.tools,
      })),
      MAX_MCP_TOOLS
    );
    const byServer = new Map(
      connections.map((connection) => [connection.config.name, connection])
    );
    replaceToolsByPrefix(
      MCP_TOOL_PREFIX,
      selected.flatMap(({ server, name, tool }) => {
        const connection = byServer.get(server);
        return connection ? [createMcpTool(connection.config, tool, name)] : [];
      })
    );
    const servers: McpServerStatus[] = [
      ...connections.map((connection): McpServerStatus => {
        const { name } = connection.config;
        return {
          name,
          state: connection.client ? 'connected' : 'failed',
          toolCount: selected.filter((item) => item.server === name).length,
          omittedToolCount: omitted.get(name) ?? 0,
          ...(connection.error !== undefined && { error: connection.error }),
        };
      }),
      ...config.invalid.map(({ name, error }): McpServerStatus => ({
        name,
        state: 'invalid',
        toolCount: 0,
        omittedToolCount: 0,
        error,
      })),
    ];
    return {
      ...(config.configError !== undefined && {
        configError: config.configError,
      }),
      servers,
    };
  } catch (error) {
    console.error('MCP のツールを同期できません:', error);
    return {
      configError: error instanceof Error ? error.message : String(error),
      servers: [],
    };
  }
}
