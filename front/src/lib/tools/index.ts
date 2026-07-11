import { Tool, OllamaToolDefinition } from './types';

const toolRegistry = new Map<string, Tool>();

/**
 * ツールをレジストリに登録する。ツール名をキーに登録し、同名なら上書きする。
 *
 * @param tool - 登録するツール実装
 */
export function registerTool(tool: Tool): void {
  toolRegistry.set(tool.definition.name, tool);
}

/**
 * 名前からレジストリ内のツールを取得する。
 *
 * @param name - 取得するツール名
 * @returns 該当するツール。未登録の場合は `undefined`
 */
export function getTool(name: string): Tool | undefined {
  return toolRegistry.get(name);
}

/**
 * 登録済み全ツールの定義を Ollama API 向け形式に変換して返す。
 *
 * @returns Ollama の function calling に渡せるツール定義の配列
 */
export function getAllToolDefinitions(): OllamaToolDefinition[] {
  return Array.from(toolRegistry.values()).map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.definition.name,
      description: tool.definition.description,
      parameters: tool.definition.parameters,
    },
  }));
}

/**
 * 指定した名前のツールを引数付きで実行する。
 *
 * @param name - 実行するツール名
 * @param args - ツールへ渡す引数（キー→値のマップ）
 * @returns ツールの実行結果文字列
 * @throws {Error} 指定名のツールが未登録の場合
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const tool = toolRegistry.get(name);
  if (!tool) {
    throw new Error(`Unknown tool: "${name}"`);
  }
  return tool.execute(args);
}

