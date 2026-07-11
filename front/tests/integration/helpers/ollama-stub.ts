import { vi } from 'vitest';

/**
 * 真の外部 3rd-party である Ollama（`ollama.ts` の global `fetch`）をスタブするヘルパー群。
 *
 * IT の方針「実依存（DB）は本物・真の外部のみスタブ」に従い、Ollama への HTTP だけを
 * 差し替える。E2E で `page.route` により障害注入していた「Ollama ダウン→502」等の
 * API 契約を、ブラウザ抜き・決定的に検証するために使う。
 */

/**
 * Ollama `/api/chat` 相当の NDJSON ストリーミング成功レスポンスを組み立てる。
 *
 * @param contents - 各チャンクが運ぶテキスト断片（順に連結される）
 * @returns `.ok` が true でボディが NDJSON ストリームの `Response`
 */
export function ollamaStreamResponse(contents: string[]): Response {
  const lines = [
    ...contents.map((content) =>
      JSON.stringify({ model: 'test', message: { role: 'assistant', content }, done: false }),
    ),
    JSON.stringify({ model: 'test', message: { role: 'assistant', content: '' }, done: true }),
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

/**
 * global `fetch` を任意のハンドラでスタブする。呼び出し記録を返すので引数検証にも使える。
 *
 * @param handler - fetch の代替実装（URL・init を受け取り Response を返す）
 * @returns スタブした fetch のモック関数
 */
export function stubFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const mock = vi.fn((input: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init)),
  );
  vi.stubGlobal('fetch', mock);
  return mock;
}
