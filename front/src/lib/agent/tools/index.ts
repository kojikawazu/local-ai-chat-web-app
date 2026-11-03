import type {
  Tool,
  OllamaToolDefinition,
  ToolContext,
  ToolExecution,
} from './types';

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
 * ツールを Ollama API 向けの定義の形にする。
 *
 * @param tool - 登録済みのツール
 * @returns Ollama の function calling に渡せるツール定義
 */
function toOllamaDefinition(tool: Tool): OllamaToolDefinition {
  return {
    type: 'function',
    function: {
      name: tool.definition.name,
      description: tool.definition.description,
      parameters: tool.definition.parameters,
    },
  };
}

/**
 * 登録済みのツールのうち、メインのモデルへ渡すものの定義を Ollama API 向け形式に変換して返す。
 *
 * サブエージェントだけのツール（`subAgentOnly`。#26）は含めない。
 *
 * @param options - `excludeVision` が true なら、結果を画像で渡すツール（`requiresVision`。#149）を除く。
 *   `excludeNames` に書いた名前のツールも除く（設定で有効にしていない委譲のツール。#26）
 * @returns Ollama の function calling に渡せるツール定義の配列
 */
export function getAllToolDefinitions(
  options: { excludeVision?: boolean; excludeNames?: readonly string[] } = {}
): OllamaToolDefinition[] {
  return Array.from(toolRegistry.values())
    .filter(
      (tool) =>
        !tool.subAgentOnly &&
        !(options.excludeVision && tool.requiresVision) &&
        !options.excludeNames?.includes(tool.definition.name)
    )
    .map(toOllamaDefinition);
}

/**
 * 名前を並べたツールのうち、登録されているものの定義を Ollama API 向け形式に変換して返す（サブエージェント。#26）。
 *
 * @param names - ツール名（この順に並べる）
 * @returns 登録されているツールの定義。登録されていない名前は飛ばす
 */
export function getToolDefinitionsByName(
  names: readonly string[]
): OllamaToolDefinition[] {
  return names.flatMap((name) => {
    const tool = toolRegistry.get(name);
    return tool ? [toOllamaDefinition(tool)] : [];
  });
}

/**
 * 結果を画像で渡すツール（`requiresVision`）が登録されているかを返す（#149）。
 *
 * 無ければ、エージェントループはモデルの対応機能を Ollama に問い合わせずに済む。
 *
 * @returns 1 つでもあれば true
 */
export function hasVisionTools(): boolean {
  return Array.from(toolRegistry.values()).some((tool) => tool.requiresVision);
}

/**
 * 指定した名前のツールを引数付きで実行する。
 *
 * @param name - 実行するツール名
 * @param args - ツールへ渡す引数（キー→値のマップ）
 * @param signal - ツールの実処理（fetch 等）を中断する signal
 * @param context - 応答ごとの文脈（{@link ToolContext}。#149）
 * @returns ツールの実行結果（モデルへ返す文章・成否・要約と、接続先ごと使えないかの印）
 * @throws {Error} 指定名のツールが未登録の場合
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
  context: ToolContext
): Promise<ToolExecution> {
  const tool = toolRegistry.get(name);
  if (!tool) {
    throw new Error(`Unknown tool: "${name}"`);
  }
  return tool.execute(args, signal, context);
}
