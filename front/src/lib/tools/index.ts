import { Tool, OllamaToolDefinition } from './types';

const toolRegistry = new Map<string, Tool>();

export function registerTool(tool: Tool): void {
  toolRegistry.set(tool.definition.name, tool);
}

export function getTool(name: string): Tool | undefined {
  return toolRegistry.get(name);
}

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

