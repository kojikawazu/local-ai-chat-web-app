import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import type { OllamaChatMessage, OllamaStreamChunk } from '@/lib/ollama';
import { streamChat } from '@/lib/ollama';
import { runAgentLoop } from '@/lib/agent';
import { initializeTools } from '@/lib/tools/registry';
import { parseChatBody, readJsonBody } from '@/lib/request-body';

// ツールを登録（registry.ts で一元管理）
initializeTools();

/**
 * Ollama にチャットメッセージを送信し、応答をストリーミングで中継する。
 *
 * 通常モードでは Ollama の生成テキストをそのまま `text/event-stream` で逐次返す。
 * `enableTools` が真の場合はエージェントループを起動し、ツール呼び出し・思考過程・
 * 最終応答を `AgentStreamEvent` の NDJSON（`application/x-ndjson`）として送信する。
 *
 * ボディは {@link parseChatBody} で検証し、不正なら Ollama を呼ばずに 400 を返す。
 *
 * @param request - `message`（必須・最大 `MAX_MESSAGE_LENGTH` 文字）・`conversationHistory`・`model`・`enableTools`・`systemPrompt` を含む JSON ボディを持つリクエスト
 * @returns 成功時はストリーミング `Response`（通常: text/event-stream、エージェント: NDJSON）。JSON 構文・形・型・上限の検証失敗時は 400、Ollama 接続・空応答時は 502 の JSON エラーレスポンス
 */
export async function POST(request: NextRequest) {
  const raw = await readJsonBody(request);
  const parsed = raw.ok ? parseChatBody(raw.value) : raw;
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { message, conversationHistory, model, enableTools, systemPrompt } =
    parsed.value;

  const messages: OllamaChatMessage[] = [
    ...conversationHistory,
    { role: 'user', content: message },
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
    // 通常チャットは思考させない（#116）。思考に対応したモデルは既定で考えてから答えるため、
    // 最初の文字が出るまで数秒、画面に何も出ない。考えさせたい場合はエージェントモードを使う
    ollamaResponse = await streamChat(messages, model, undefined, {
      think: false,
    });
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
