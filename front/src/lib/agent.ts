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

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`ツール "${name}" がタイムアウトしました (${TOOL_TIMEOUT_MS}ms)`)),
      TOOL_TIMEOUT_MS
    );
  });

  try {
    const result = await Promise.race([executeTool(name, args), timeoutPromise]);
    clearTimeout(timeoutId);
    return { result, isError: false, durationMs: Date.now() - start };
  } catch (e) {
    clearTimeout(timeoutId);
    const msg = e instanceof Error ? e.message : String(e);
    return { result: msg, isError: true, durationMs: Date.now() - start };
  }
}

// Ollama のストリーミングレスポンスを読み取り、tool_calls かテキストかを判定する。
// Ollama は tool_calls がある場合、done=true のチャンクに tool_calls を含めて返す。
// テキスト応答の場合は各チャンクを逐次ストリームに流してリアルタイム表示を維持する。
async function readOllamaResponse(
  response: Response,
  onTextChunk: (text: string) => void,
  onThinking: (text: string) => void
): Promise<{ toolCalls: OllamaToolCall[] }> {
  if (!response.body) {
    throw new Error('Ollama からのレスポンスが空です');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let lineBuffer = '';
  const toolCalls: OllamaToolCall[] = [];

  // <think>...</think> をストリーム全体にわたって検出するためのバッファ
  let contentBuffer = '';
  let inThinkBlock = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    lineBuffer += decoder.decode(value, { stream: true });
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const chunk: OllamaStreamChunk = JSON.parse(line);

        // tool_calls を収集（通常は done=true のチャンクに含まれる）
        if (chunk.message?.tool_calls) {
          toolCalls.push(...chunk.message.tool_calls);
        }

        if (chunk.message?.content && !chunk.message.tool_calls) {
          contentBuffer += chunk.message.content;

          // <think>...</think> ブロックをストリーム全体で検出する
          // チャンクをまたいでタグが分割される場合を正しく処理する
          while (contentBuffer.length > 0) {
            if (inThinkBlock) {
              const closeIdx = contentBuffer.indexOf('</think>');
              if (closeIdx >= 0) {
                // 閉じタグが見つかった → thinking コンテンツを通知
                const thinkingContent = contentBuffer.slice(0, closeIdx);
                if (thinkingContent) onThinking(thinkingContent);
                contentBuffer = contentBuffer.slice(closeIdx + '</think>'.length);
                inThinkBlock = false;
              } else {
                // まだ閉じタグが来ていない → バッファを保持
                break;
              }
            } else {
              const openIdx = contentBuffer.indexOf('<think>');
              if (openIdx >= 0) {
                // 開きタグより前のテキストを即時通知
                const before = contentBuffer.slice(0, openIdx);
                if (before) onTextChunk(before);
                contentBuffer = contentBuffer.slice(openIdx + '<think>'.length);
                inThinkBlock = true;
              } else {
                // <think> タグの途中（例: "<thi"）かもしれないので末尾を保持
                // </think> も考慮して長い方のタグ長 - 1 を保持する
                const possibleTagStart = Math.max('<think>'.length, '</think>'.length) - 1;
                if (contentBuffer.length > possibleTagStart) {
                  const safeFlush = contentBuffer.slice(0, contentBuffer.length - possibleTagStart);
                  if (safeFlush) onTextChunk(safeFlush);
                  contentBuffer = contentBuffer.slice(contentBuffer.length - possibleTagStart);
                }
                break;
              }
            }
          }
        }
      } catch {
        // JSONパース失敗は無視
      }
    }
  }

  // ストリーム終了時に残ったバッファをフラッシュ
  if (contentBuffer) {
    // 閉じタグが来なかった場合（不正な出力）も thinking として扱う
    if (inThinkBlock) {
      onThinking(contentBuffer);
    } else {
      onTextChunk(contentBuffer);
    }
  }

  return { toolCalls };
}

/**
 * エージェントループを実行し、進捗を NDJSON イベントとして流す ReadableStream を返す。
 *
 * ツール呼び出しが無くなるまで最大 `MAX_TOOL_ROUNDS` 回、Ollama への問い合わせと
 * ツール実行を繰り返す。テキストは逐次 `text_delta` で中継し、`<think>` ブロックは
 * `thinking` イベントとして分離する。エージェントモード（enableTools=true）時に呼ぶ。
 *
 * @param messages - 会話履歴（user / assistant / tool を時系列で並べる）
 * @param model - 使用モデル名。未指定時はデフォルトモデルを使う
 * @param systemPrompt - 先頭に付与するシステムプロンプト。空・未指定なら付与しない
 * @returns NDJSON イベント（text_delta / thinking / tool_call_start / tool_call_result / done / error）を流すストリーム
 */
export function runAgentLoop(
  messages: OllamaChatMessage[],
  model?: string,
  systemPrompt?: string
): ReadableStream<Uint8Array> {
  const tools = getAllToolDefinitions();
  const toolCallRecords: ToolCallRecord[] = [];

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      // システムプロンプトがあれば先頭に追加
      const systemMessages: OllamaChatMessage[] = systemPrompt?.trim()
        ? [{ role: 'system' as const, content: systemPrompt.trim() }]
        : [];
      const history: OllamaChatMessage[] = [...systemMessages, ...messages];
      const loopStartTime = Date.now();

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

          const { toolCalls } = await readOllamaResponse(
            ollamaResponse,
            (text) => {
              // テキストチャンクをリアルタイムに送信（バッファなし）
              if (text) {
                controller.enqueue(encodeEvent({ type: 'text_delta', content: text }));
              }
            },
            (thinking) => {
              if (thinking.trim()) {
                controller.enqueue(encodeEvent({ type: 'thinking', content: thinking.trim() }));
              }
            }
          );

          // ツール呼び出しなし → テキスト応答のストリーミングは上記コールバックで完了済み
          if (toolCalls.length === 0) {
            // 完了イベント（ツール呼び出し記録・実行統計付き）
            controller.enqueue(
              encodeEvent({
                type: 'done',
                metadata: {
                  toolCalls: toolCallRecords,
                  agentRounds: round + 1,
                  agentDurationMs: Date.now() - loopStartTime,
                },
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
