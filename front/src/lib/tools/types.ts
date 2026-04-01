// Ollama API 向けツール定義
export interface OllamaToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<
        string,
        {
          type: string;
          description: string;
          enum?: string[];
        }
      >;
      required: string[];
    };
  };
}

// Ollama レスポンスのツール呼び出し
export interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

// ツール実行記録（DB の metadata.toolCalls に保存）
export interface ToolCallRecord {
  name: string;
  arguments: Record<string, unknown>;
  result: string;
  isError: boolean;
  durationMs: number;
}

// クライアント向けストリーミングイベント（NDJSON 形式）
export type AgentStreamEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_call_start'; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_call_result'; name: string; result: string; isError: boolean }
  | { type: 'done'; metadata?: { toolCalls: ToolCallRecord[] } }
  | { type: 'error'; message: string }
  | { type: 'thinking'; content: string }; // Phase C

// ツール定義インターフェース
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<
      string,
      {
        type: string;
        description: string;
        enum?: string[];
      }
    >;
    required: string[];
  };
}

// ツール実装インターフェース
export interface Tool {
  definition: ToolDefinition;
  execute: (args: Record<string, unknown>) => Promise<string>;
}
