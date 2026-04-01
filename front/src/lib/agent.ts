import { streamChat, OllamaChatMessage, OllamaStreamChunk } from './ollama';
import { getAllToolDefinitions, executeTool } from './tools/index';
import type { AgentStreamEvent, ToolCallRecord, OllamaToolCall } from './tools/types';

const MAX_TOOL_ROUNDS = parseInt(process.env.AGENT_MAX_TOOL_ROUNDS ?? '10', 10);
const TOOL_TIMEOUT_MS = parseInt(process.env.AGENT_TOOL_TIMEOUT_MS ?? '30000', 10);

// NDJSON イベントを ReadableStream に書き込むヘルパー
function encodeEvent(event: AgentStreamEvent): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(event) + '\n');
}

// ツール実行（タイムアウト付き、全体タイムアウトはリトライ含む合計に適用）
async function runTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ result: string; isError: boolean; durationMs: number }> {
  const start = Date.now();

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`ツール "${name}" がタイムアウトしました (${TOOL_TIMEOUT_MS}ms)`)),
      TOOL_TIMEOUT_MS
    )
  );

  try {
    const result = await Promise.race([executeTool(name, args), timeoutPromise]);
    return { result, isError: false, durationMs: Date.now() - start };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { result: msg, isError: true, durationMs: Date.now() - start };
  }
}

// Ollama のストリーミングレスポンスを読み取り、tool_calls かテキストかを判定する
async function readOllamaResponse(response: Response): Promise<{
  toolCalls: OllamaToolCall[];
  textStream: ReadableStream<Uint8Array> | null;
  thinkingText: string;
}> {
  if (!response.body) {
    throw new Error('Ollama からのレスポンスが空です');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const toolCalls: OllamaToolCall[] = [];
  let thinkingText = '';

  // ツール呼び出しか判定するために全チャンクを先読みする
  const chunks: OllamaStreamChunk[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const chunk: OllamaStreamChunk = JSON.parse(line);
        chunks.push(chunk);

        // tool_calls を収集
        if (chunk.message?.tool_calls) {
          toolCalls.push(...chunk.message.tool_calls);
        }

        // thinking テキストを収集（<think> タグ内、または tool_calls 前のテキスト）
        if (chunk.message?.content && !chunk.message.tool_calls) {
          const content = chunk.message.content;
          const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
          if (thinkMatch) {
            thinkingText += thinkMatch[1];
          }
        }
      } catch {
        // JSONパース失敗は無視
      }
    }
  }

  // tool_calls があった場合はテキストストリームなし
  if (toolCalls.length > 0) {
    return { toolCalls, textStream: null, thinkingText };
  }

  // テキスト応答の場合: 収集済みチャンクを ReadableStream に変換して返す
  const textStream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        if (chunk.message?.content) {
          controller.enqueue(new TextEncoder().encode(chunk.message.content));
        }
      }
      controller.close();
    },
  });

  return { toolCalls: [], textStream, thinkingText };
}

// エージェントループのメイン関数
// enableTools: true のときに呼び出す。NDJSON イベントストリームを返す。
export function runAgentLoop(
  messages: OllamaChatMessage[],
  model?: string
): ReadableStream<Uint8Array> {
  const tools = getAllToolDefinitions();
  const toolCallRecords: ToolCallRecord[] = [];

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      // メッセージ履歴のコピー（ループ内で更新する）
      const history: OllamaChatMessage[] = [...messages];

      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          let ollamaResponse: Response;
          try {
            ollamaResponse = await streamChat(history, model, tools);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            controller.enqueue(
              encodeEvent({ type: 'error', message: `Ollamaへの接続に失敗しました: ${msg}` })
            );
            controller.close();
            return;
          }

          const { toolCalls, textStream, thinkingText } =
            await readOllamaResponse(ollamaResponse);

          // thinking テキストがあれば送信
          if (thinkingText.trim()) {
            controller.enqueue(
              encodeEvent({ type: 'thinking', content: thinkingText.trim() })
            );
          }

          // ツール呼び出しなし → テキスト応答をストリーミングして完了
          if (toolCalls.length === 0) {
            if (textStream) {
              const reader = textStream.getReader();
              const decoder = new TextDecoder();
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const text = decoder.decode(value);
                if (text) {
                  controller.enqueue(encodeEvent({ type: 'text_delta', content: text }));
                }
              }
            }
            // 完了イベント（ツール呼び出し記録付き）
            controller.enqueue(
              encodeEvent({
                type: 'done',
                metadata: toolCallRecords.length > 0 ? { toolCalls: toolCallRecords } : undefined,
              })
            );
            controller.close();
            return;
          }

          // ツール呼び出しあり → assistant メッセージを履歴に追加
          history.push({
            role: 'assistant',
            content: '',
            tool_calls: toolCalls,
          });

          // 複数ツールを Promise.allSettled で並列実行
          const toolResults = await Promise.allSettled(
            toolCalls.map(async (tc) => {
              const name = tc.function.name;
              const args = tc.function.arguments;

              // 実行開始イベント
              controller.enqueue(
                encodeEvent({ type: 'tool_call_start', name, arguments: args })
              );

              const { result, isError, durationMs } = await runTool(name, args);

              // 実行結果イベント
              controller.enqueue(
                encodeEvent({ type: 'tool_call_result', name, result, isError })
              );

              toolCallRecords.push({ name, arguments: args, result, isError, durationMs });

              return { name, result };
            })
          );

          // tool ロールのメッセージを呼び出し順で履歴に追加
          for (let i = 0; i < toolCalls.length; i++) {
            const settled = toolResults[i];
            const result =
              settled.status === 'fulfilled'
                ? settled.value.result
                : settled.reason instanceof Error
                  ? settled.reason.message
                  : String(settled.reason);

            history.push({ role: 'tool', content: result });
          }
        }

        // 最大ラウンド数超過
        controller.enqueue(
          encodeEvent({
            type: 'error',
            message: `ツール呼び出しが最大ラウンド数(${MAX_TOOL_ROUNDS})を超えました`,
          })
        );
        controller.close();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        controller.enqueue(encodeEvent({ type: 'error', message: msg }));
        controller.close();
      }
    },
  });
}
