import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import type { OllamaChatMessage, OllamaStreamChunk } from '@/lib/llm/ollama';
import {
  getDefaultModel,
  streamChat,
  supportsVision,
  withSystemPrompt,
} from '@/lib/llm/ollama';
import { runAgentLoop } from '@/lib/agent/agent';
import { getLocalTimeZone, withCurrentDate } from '@/lib/llm/current-date';
import { initializeTools } from '@/lib/agent/tools/registry';
import type { ChatBody } from '@/lib/server/request-body';
import { parseChatBody, readJsonBody } from '@/lib/server/request-body';
import {
  selectChatImages,
  withOmittedImagesNote,
} from '@/lib/server/chat-images';
import { prisma } from '@/lib/server/prisma';

// ツールを登録（registry.ts で一元管理）
initializeTools();

// 応答を受け取る前にブラウザが停止・切断したときのステータス。受け取る相手はいないため
// 値はログ・計測上の区別のためだけに使う（nginx の「Client Closed Request」と同じ番号）
const CLIENT_CLOSED_REQUEST = 499;

/** {@link buildMessages} の結果。失敗時はクライアントへ返すステータスとエラーメッセージを持つ。 */
type BuildResult =
  | { ok: true; messages: OllamaChatMessage[] }
  | { ok: false; status: number; error: string };

/**
 * 検証済みのボディから、Ollama へ送る会話（履歴 + 送信する質問）を組み立てる。
 *
 * 添付画像（#6）は ID で届くため、LLM へ渡す画像を選んで（{@link selectChatImages}）DB から読み、
 * Base64 にして `images` に入れる。渡さない画像は本文に注記する。画像が 1 枚も無ければ
 * Ollama・DB に問い合わせない（画像を使わない会話の処理を変えない）。
 *
 * @param body - 検証済みのボディ
 * @returns 組み立てた会話。送信する質問に画像があるのにモデルが画像に対応していなければ 400、
 *   見つからない添付があれば 400、モデルの対応機能を問い合わせられなければ 502、DB の読み込みに失敗すれば 500
 */
async function buildMessages(body: ChatBody): Promise<BuildResult> {
  const entries = [
    ...body.conversationHistory,
    { role: 'user' as const, content: body.message, imageIds: body.imageIds },
  ];
  if (entries.every((entry) => entry.imageIds.length === 0)) {
    return {
      ok: true,
      messages: entries.map(({ role, content }) => ({ role, content })),
    };
  }

  let vision: boolean;
  try {
    vision = await supportsVision(body.model);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    console.error('Ollama connection error:', errorMessage);
    return {
      ok: false,
      status: 502,
      error: `Ollamaへの接続に失敗しました: ${errorMessage}`,
    };
  }
  // Ollama の 400（Multimodal data provided...）を 502 として返さず、入力の問題として先に弾く。
  // 履歴にだけ画像がある場合は画像を外して続ける（会話の途中でモデルを切り替えても続けられるように）
  if (!vision && body.imageIds.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `選択中のモデル（${body.model || getDefaultModel()}）は画像に対応していません`,
    };
  }

  const selections = selectChatImages(
    entries.map((entry) => entry.imageIds),
    { supportsVision: vision }
  );
  const ids = selections.flatMap((selection) => selection.includedIds);

  let images: Map<string, string>;
  try {
    const rows = await prisma.attachment.findMany({
      where: { id: { in: ids } },
      select: { id: true, data: true },
    });
    images = new Map(
      rows.map((row) => [row.id, Buffer.from(row.data).toString('base64')])
    );
  } catch (error) {
    console.error('Failed to load attachments:', error);
    return { ok: false, status: 500, error: '画像の読み込みに失敗しました' };
  }
  if (images.size !== ids.length) {
    return { ok: false, status: 400, error: '画像が見つかりません' };
  }

  return {
    ok: true,
    messages: entries.map((entry, index) => {
      const selection = selections[index];
      return {
        role: entry.role,
        content: withOmittedImagesNote(entry.content, selection),
        ...(selection.includedIds.length > 0 && {
          // images.size === ids.length を確かめたため、選んだ ID はすべて Map にある
          images: selection.includedIds.map((id) => images.get(id) ?? ''),
        }),
      };
    }),
  };
}

/**
 * Ollama にチャットメッセージを送信し、応答をストリーミングで中継する。
 *
 * `systemPrompt`（会話の役割と、エージェントモードならそのプリセットを連結したもの。#10）があれば、
 * どちらのモードでも会話履歴の先頭に system メッセージとして付ける。その後ろには現在の日時の節を
 * 必ず足す（{@link withCurrentDate}。#154）ため、`systemPrompt` が空でも system メッセージは付く。
 * 通常モードでは Ollama の生成テキストをそのまま `text/event-stream` で逐次返す。
 * `enableTools` が真の場合はエージェントループを起動し、ツール呼び出し・思考過程・
 * 最終応答を `AgentStreamEvent` の NDJSON（`application/x-ndjson`）として送信する。
 *
 * ボディは {@link parseChatBody} で検証し、不正なら Ollama を呼ばずに 400 を返す。
 * 添付画像の ID（`imageIds`・履歴の各要素の `imageIds`。#6）は DB から読んで Ollama の `images` へ渡す
 * （{@link buildMessages}）。
 * ブラウザが停止・切断した場合（`request.signal` の abort・応答ストリームの cancel）は、
 * Ollama への接続を切って生成を止める。
 *
 * @param request - `message`（必須・最大 `MAX_MESSAGE_LENGTH` 文字）・`imageIds`・`conversationHistory`・`model`・`enableTools`・`systemPrompt` を含む JSON ボディを持つリクエスト
 * @returns 成功時はストリーミング `Response`（通常: text/event-stream、エージェント: NDJSON）。JSON 構文・形・型・上限の検証失敗時・画像に対応していないモデルへの画像の送信・見つからない添付は 400、Ollama 接続・空応答時は 502、添付の読み込み失敗は 500 の JSON エラーレスポンス。Ollama の応答前に停止・切断された場合は本文なしの 499
 */
export async function POST(request: NextRequest) {
  const raw = await readJsonBody(request);
  const parsed = raw.ok ? parseChatBody(raw.value) : raw;
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { model, enableTools, systemPrompt } = parsed.value;

  const built = await buildMessages(parsed.value);
  if (!built.ok) {
    return NextResponse.json({ error: built.error }, { status: built.status });
  }
  const { messages } = built;
  // 今日の日付を必ず知らせる。知らせないと「最新」を学習時点の年で検索・回答する（#154）
  const prompt = withCurrentDate(systemPrompt, {
    now: new Date(),
    timeZone: getLocalTimeZone(),
    enableTools,
  });

  // エージェントモード: NDJSON イベントストリームを返す
  if (enableTools) {
    const agentStream = runAgentLoop(messages, model, prompt, request.signal);
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
    ollamaResponse = await streamChat(
      withSystemPrompt(messages, prompt),
      model,
      undefined,
      {
        think: false,
        // ブラウザが停止・切断したら Ollama への接続も切り、生成を止める（#8）
        signal: request.signal,
      }
    );
  } catch (error) {
    // モデルの読み込み待ちの間に停止された。接続の失敗ではないため 502 にもログにもしない
    if (request.signal.aborted) {
      return new Response(null, { status: CLIENT_CLOSED_REQUEST });
    }
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
  let cancelled = false;

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
        // 停止・切断で読み取りを打ち切った（閉じたストリームへの close も含む）。エラーではない。
        // request.signal だけが abort された場合はストリームが開いたままなので閉じる
        if (cancelled || request.signal.aborted) {
          try {
            controller.close();
          } catch {
            // cancel 済み
          }
          return;
        }
        console.error('Streaming error:', error);
        controller.error(error);
      }
    },
    cancel() {
      // ブラウザが停止・切断した。Ollama の読み取りを止めて接続を切り、生成を止める（#8）
      cancelled = true;
      return reader.cancel();
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
