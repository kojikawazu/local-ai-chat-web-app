export interface ToolCallInfo {
  name: string;
  arguments: Record<string, unknown>;
  result: string;
  isError: boolean;
  durationMs: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
  metadata?: {
    toolCalls?: ToolCallInfo[];
    thinkingText?: string;
    agentRounds?: number;
    agentDurationMs?: number;
  } | null;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}
