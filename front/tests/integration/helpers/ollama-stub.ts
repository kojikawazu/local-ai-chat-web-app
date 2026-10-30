import { vi } from 'vitest';

/**
 * 真の外部 3rd-party である Ollama（`ollama.ts` の global `fetch`）をスタブするヘルパー群。
 *
 * IT の方針「実依存（DB）は本物・真の外部のみスタブ」に従い、Ollama への HTTP だけを
 * 差し替える。E2E で `page.route` により障害注入していた「Ollama ダウン→502」等の
 * API 契約を、ブラウザ抜き・決定的に検証するために使う。
 */

/**
 * 終わりのチャンクに足すトークン数・所要時間（`eval_count`・`eval_duration` 等。時間はナノ秒。#31）。
 * 省略すると終わりのチャンクは値を持たない（値を返さない Ollama と同じ）。
 */
export type StubDoneMetrics = Partial<
  Record<
    | 'prompt_eval_count'
    | 'prompt_eval_cached_count'
    | 'prompt_eval_duration'
    | 'eval_count'
    | 'eval_duration'
    | 'load_duration'
    | 'total_duration',
    number
  >
>;

/**
 * Ollama `/api/chat` 相当の NDJSON ストリーミング成功レスポンスを組み立てる。
 *
 * @param contents - 各チャンクが運ぶテキスト断片（順に連結される）
 * @param metrics - 終わりのチャンクに足すトークン数・所要時間（省略時は持たない）
 * @returns `.ok` が true でボディが NDJSON ストリームの `Response`
 */
export function ollamaStreamResponse(
  contents: string[],
  metrics: StubDoneMetrics = {}
): Response {
  const lines = [
    ...contents.map((content) =>
      JSON.stringify({
        model: 'test',
        message: { role: 'assistant', content },
        done: false,
      })
    ),
    JSON.stringify({
      model: 'test',
      message: { role: 'assistant', content: '' },
      done: true,
      ...metrics,
    }),
  ]
    .map((l) => l + '\n')
    .join('');

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(lines));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' },
  });
}

/** {@link ollamaChunksResponse} の 1 チャンクが運ぶメッセージ断片。 */
type StubChunkMessage = {
  /** 本文の断片 */
  content?: string;
  /** 思考過程の断片（思考に対応したモデルが本文とは別に返すフィールド） */
  thinking?: string;
  /** ツール呼び出し要求 */
  tool_calls?: {
    function: { name: string; arguments: Record<string, unknown> };
  }[];
};

/**
 * Ollama `/api/chat` 相当の NDJSON ストリーミング応答を、チャンクの中身を指定して組み立てる。
 *
 * {@link ollamaStreamResponse} は本文だけを運ぶ。思考過程（`message.thinking`）や
 * ツール呼び出しを本文と混ぜた順序で流したい場合に使う。末尾に `done: true` のチャンクを付ける。
 *
 * @param chunks - 各チャンクが運ぶメッセージ断片（この順に流れる）
 * @param metrics - 終わりのチャンクに足すトークン数・所要時間（省略時は持たない）
 * @returns `.ok` が true でボディが NDJSON ストリームの `Response`
 */
export function ollamaChunksResponse(
  chunks: StubChunkMessage[],
  metrics: StubDoneMetrics = {}
): Response {
  const lines = [
    ...chunks.map((message) =>
      JSON.stringify({
        model: 'test',
        message: { role: 'assistant', content: '', ...message },
        done: false,
      })
    ),
    JSON.stringify({
      model: 'test',
      message: { role: 'assistant', content: '' },
      done: true,
      ...metrics,
    }),
  ]
    .map((l) => l + '\n')
    .join('');

  return new Response(lines, {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' },
  });
}

/**
 * global `fetch` を任意のハンドラでスタブする。呼び出し記録を返すので引数検証にも使える。
 *
 * @param handler - fetch の代替実装（URL・init を受け取り Response を返す）
 * @returns スタブした fetch のモック関数
 */
export function stubFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
) {
  const mock = vi.fn((input: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init))
  );
  vi.stubGlobal('fetch', mock);
  return mock;
}
