import { MCP_ORIGIN_PREFIX } from '@/constants/agent/mcp';
import type { McpServerConfig, McpToolInfo } from '@/types/agent/mcp';
import type { McpApprovalPreview } from '@/types/agent/tool-call';
import type { Tool, ToolDefinition } from '../types';
import { toolNeedsApproval, toolUnavailable } from '../output';
import { callMcpTool, isMcpConnected } from './connections';
import { readSourceLabels } from './naming';

/** モデルへ渡す説明の長さの上限（文字）。サーバーの書いた文章がモデルへ入る量を抑える */
const MAX_DESCRIPTION_CHARS = 1_024;

/**
 * サーバーの JSON Schema を、モデルへ渡す引数の定義にする。
 *
 * `$schema` は Ollama へ渡す意味が無いため外す。`properties`・`required` はサーバーが省くことがあるため補う。
 *
 * @param schema - サーバーが返した `inputSchema`
 * @returns 引数の定義
 */
function toParameters(
  schema: Record<string, unknown>
): ToolDefinition['parameters'] {
  const rest = Object.fromEntries(
    Object.entries(schema).filter(([key]) => key !== '$schema')
  );
  const { properties, required } = schema;
  return {
    ...rest,
    type: 'object',
    // why: サーバーの申告の JSON Schema をそのまま Ollama へ渡すだけで、アプリは中身を読まない。
    // 値の検証はサーバーが行うため、形を確かめずに型だけを当てる
    properties: (typeof properties === 'object' && properties !== null
      ? properties
      : {}) as ToolDefinition['parameters']['properties'],
    required: Array.isArray(required)
      ? required.filter((item) => typeof item === 'string')
      : [],
  };
}

/**
 * MCP のサーバーのツールを、エージェントのツールにする（#208。`docs/31-mcp-client.md`）。
 *
 * どのサーバーも「非公開の情報を読む」と「外部と通信する」の両方の性質を持つものとして扱う（`access: 'network'` と `origin`）。
 * `readOnlyHint: true` で `alwaysApprove` に無いツールだけ承認なしで実行し、ほかは実行前に承認を求める。
 *
 * @param server - サーバーの設定
 * @param tool - サーバーが返したツール
 * @param name - モデルへ渡す名前
 * @returns ツール
 */
export function createMcpTool(
  server: McpServerConfig,
  tool: McpToolInfo,
  name: string
): Tool {
  const origin = `${MCP_ORIGIN_PREFIX}${server.name}`;
  const base: Tool = {
    definition: {
      name,
      description: (tool.description ?? tool.name).slice(
        0,
        MAX_DESCRIPTION_CHARS
      ),
      parameters: toParameters(tool.inputSchema),
    },
    access: 'network',
    origin,
    execute: (args, signal) =>
      callMcpTool(server.name, tool.name, args, signal),
  };
  const readOnly =
    tool.annotations?.readOnlyHint === true &&
    !server.alwaysApprove.includes(tool.name);
  if (readOnly) return base;

  return {
    ...base,
    execute: async () => toolNeedsApproval(),
    prepare: async (args, _signal, context) => {
      if (!isMcpConnected(server.name)) {
        return {
          ok: false,
          output: toolUnavailable(
            `MCP のサーバー ${server.name} に接続していません`
          ),
        };
      }
      const preview: McpApprovalPreview = {
        action: 'mcp-call',
        server: server.name,
        tool: tool.name,
        arguments: JSON.stringify(args, null, 2),
        readSources: readSourceLabels(context?.readOrigins?.() ?? [], origin),
      };
      return {
        ok: true,
        preview,
        run: (signal) => callMcpTool(server.name, tool.name, args, signal),
      };
    },
  };
}
