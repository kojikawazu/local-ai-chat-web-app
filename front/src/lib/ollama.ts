const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'qwen3-coder:latest';

export interface OllamaChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface OllamaStreamChunk {
  model: string;
  message: { role: string; content: string };
  done: boolean;
}

export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
}

export async function listModels(): Promise<OllamaModel[]> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Ollama API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data.models ?? [];
}

export function getDefaultModel(): string {
  return OLLAMA_DEFAULT_MODEL;
}

export async function streamChat(
  messages: OllamaChatMessage[],
  model?: string
): Promise<Response> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || OLLAMA_DEFAULT_MODEL,
      messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Ollama API error (${response.status}): ${errorText}`);
  }

  return response;
}
