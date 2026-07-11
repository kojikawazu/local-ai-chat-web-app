import { NextRequest, NextResponse } from 'next/server';
import { streamChat, OllamaChatMessage, OllamaStreamChunk } from '@/lib/ollama';
import { runAgentLoop } from '@/lib/agent';
import { initializeTools } from '@/lib/tools/registry';

// ツールを登録（registry.ts で一元管理）
initializeTools();

/**
 * Ollama にチャットメッセージを送信し、応答をストリーミングで中継する。
 *
 * 通常モードでは Ollama の生成テキストをそのまま `text/event-stream` で逐次返す。
 * `enableTools` が真の場合はエージェントループを起動し、ツール呼び出し・思考過程・
 * 最終応答を `AgentStreamEvent` の NDJSON（`application/x-ndjson`）として送信する。
 *
 * @param request - `message`（必須・最大10,000文字）・`conversationHistory`・`model`・`enableTools`・`systemPrompt` を含む JSON ボディを持つリクエスト
 * @returns 成功時はストリーミング `Response`（通常: text/event-stream、エージェント: NDJSON）。バリデーション失敗時は 400、Ollama 接続・空応答時は 502 の JSON エラーレスポンス
 */
export async function POST(request: NextRequest) {
  let body: {
    message?: string;
    conversationHistory?: OllamaChatMessage[];
    model?: string;
    enableTools?: boolean;
    systemPrompt?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'リクエストボディのJSON形式が不正です' },
      { status: 400 }
    );
  }

  const { message, conversationHistory = [], model, enableTools = false, systemPrompt } = body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return NextResponse.json({ error: 'メッセージが空です' }, { status: 400 });
  }

  if (message.trim().length > 10000) {
    return NextResponse.json(
      { error: 'メッセージは10,000文字以内で入力してください' },
      { status: 400 }
    );
  }

  const messages: OllamaChatMessage[] = [
    ...conversationHistory,
    { role: 'user', content: message.trim() },
  ];

  // エージェントモード: NDJSON イベントストリームを返す
  if (enableTools) {
    const agentStream = runAgentLoop(messages, model, systemPrompt);
    return new Response(agentStream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  let ollamaResponse: Response;
  try {
    ollamaResponse = await streamChat(messages, model);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    console.error('Ollama connection error:', errorMessage);
    return NextResponse.json(
      { error: `Ollamaへの接続に失敗しました: ${errorMessage}` },
      { status: 502 }
    );
  }

  if (!ollamaResponse.body) {
    return NextResponse.json(
      { error: 'Ollamaからのレスポンスが空です' },
      { status: 502 }
    );
  }

  const reader = ollamaResponse.body.getReader();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;

            try {
              const chunk: OllamaStreamChunk = JSON.parse(line);
              if (chunk.message?.content) {
                controller.enqueue(
                  new TextEncoder().encode(chunk.message.content)
                );
              }
              if (chunk.done) {
                controller.close();
                return;
              }
            } catch {
              // JSONパース失敗は無視して次の行へ
            }
          }
        }

        controller.close();
      } catch (error) {
        console.error('Streaming error:', error);
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
