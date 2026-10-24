import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  vi,
} from 'vitest';
import type { NextRequest } from 'next/server';
import type { AgentStreamEvent } from '@/lib/tools/types';
import { jsonRequest } from './helpers/db';
import {
  ollamaChunksResponse,
  ollamaStreamResponse,
  stubFetch,
} from './helpers/ollama-stub';

/**
 * `/api/chat`（エージェント経路・`url_fetch` / `web_search`）の IT。
 *
 * 真の外部である Ollama と取得先 Web サーバー（任意 URL・SearXNG）を fetch スタブで
 * 差し替え、「Ollama がツールを要求 → ツールが外部を取得 → 結果を NDJSON の
 * tool_call_result で返す」配線を決定的に検証する。E2E では実 LLM がツールを
 * 呼ぶかが非決定的なため、ツール結果の中身（サイズ超過・タイムアウト・SSRF）の
 * 契約はここで担保する（#92）。この経路は DB を使わない。
 */
const URL = 'http://localhost/api/chat';

// 取得先には文書用アドレス（TEST-NET-3, RFC 5737）の IP リテラルを使う。
// IP リテラルは DNS 解決でネットワークに出ず、SSRF ブロックリストにも該当しない
const TARGET_URL = 'http://203.0.113.10/page';

// ツールタイムアウトを短縮して「止まった本文」を待つ時間を抑える。
// agent.ts はこの値をモジュール読み込み時に確定するため、route は beforeAll で
// 環境変数を設定した後に動的 import する（ファイルごとにモジュールは隔離される）
const TOOL_TIMEOUT_MS = 300;

let POST: (request: NextRequest) => Promise<Response>;

beforeAll(async () => {
  vi.stubEnv('AGENT_TOOL_TIMEOUT_MS', String(TOOL_TIMEOUT_MS));
  ({ POST } = await import('@/app/api/chat/route'));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** LLM が要求するツール呼び出し（ツール名と引数） */
type ToolCallSpec = { name: string; arguments: Record<string, unknown> };

const urlFetchCall = (url: string): ToolCallSpec => ({
  name: 'url_fetch',
  arguments: { url },
});
const webSearchCall = (query: string): ToolCallSpec => ({
  name: 'web_search',
  arguments: { query },
});

/**
 * 1 回目の問い合わせでツール呼び出しを要求する Ollama 応答を作る。
 * Ollama は tool_calls を done=true のチャンクに含めて返す（agent.ts の readOllamaResponse 参照）。
 *
 * @param call - LLM が要求するツール呼び出し
 * @returns tool_calls を含む NDJSON ストリームの `Response`
 */
function ollamaToolCallResponse(call: ToolCallSpec): Response {
  const line = JSON.stringify({
    model: 'test',
    message: {
      role: 'assistant',
      content: '',
      tool_calls: [{ function: call }],
    },
    done: true,
  });
  return new Response(line + '\n', {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' },
  });
}

/**
 * Ollama と取得先の両方を 1 つの fetch スタブで捌く。
 * Ollama への 1 回目はツール呼び出し、2 回目以降は最終回答のテキストを返す。
 *
 * @param call - LLM が要求するツール呼び出し
 * @param target - 取得先への fetch に返すレスポンス（init から signal を、requested から要求先の URL を観測できる）
 * @returns スタブした fetch のモック関数
 */
function stubAgentFetch(
  call: ToolCallSpec,
  target: (init: RequestInit | undefined, requested: string) => Response
) {
  let ollamaCalls = 0;
  return stubFetch((requested, init) => {
    if (requested.endsWith('/api/chat')) {
      ollamaCalls++;
      return ollamaCalls === 1
        ? ollamaToolCallResponse(call)
        : ollamaStreamResponse(['完了']);
    }
    return target(init, requested);
  });
}

/**
 * エージェント経路でメッセージを送り、NDJSON を読み切ってイベント列に変換する。
 *
 * @returns 受信した `AgentStreamEvent` の配列（受信順）
 */
async function runAgent(): Promise<AgentStreamEvent[]> {
  const res = await POST(
    jsonRequest(URL, 'POST', { message: '取得して', enableTools: true })
  );
  expect(res.status).toBe(200);
  const body = await res.text();
  return body
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as AgentStreamEvent);
}

/**
 * イベント列から指定ツールの tool_call_result を 1 件取り出す。
 *
 * @param events - `runAgent` が返したイベント列
 * @param name - 対象のツール名（既定は url_fetch）
 * @returns 指定ツールの実行結果イベント
 */
function toolResultOf(events: AgentStreamEvent[], name = 'url_fetch') {
  const result = events.find(
    (e) => e.type === 'tool_call_result' && e.name === name
  );
  // find は union を絞り込まないため、上の条件で確定したバリアントに型を合わせる
  return result as Extract<AgentStreamEvent, { type: 'tool_call_result' }>;
}

/**
 * 終端せず固定サイズのチャンクを流し続ける本文（Content-Length なしの巨大な chunked 応答）。
 *
 * @param headers - 付与するレスポンスヘッダー
 * @returns 本文を流す `Response` と、pull 回数・cancel 有無を読む観測オブジェクト
 */
function endlessTextResponse(headers: Record<string, string>) {
  const chunkBytes = 64 * 1024;
  const observed = { pulls: 0, cancelled: false, chunkBytes };
  const res = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        observed.pulls++;
        controller.enqueue(new Uint8Array(chunkBytes).fill(0x61));
      },
      cancel() {
        observed.cancelled = true;
      },
    }),
    { status: 200, headers }
  );
  return { res, observed };
}

describe('POST /api/chat（エージェント・url_fetch）', () => {
  describe('正常系', () => {
    it('取得したテキストを tool_call_result で返し、最終回答まで完了する', async () => {
      stubAgentFetch(
        urlFetchCall(TARGET_URL),
        () =>
          new Response('ページ本文です', {
            status: 200,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
          })
      );

      const events = await runAgent();

      expect(toolResultOf(events)).toMatchObject({
        result: 'ページ本文です',
        isError: false,
      });
      expect(events.at(-1)?.type).toBe('done');
    });

    it('web_search は SearXNG の JSON API に問い合わせ、結果を一覧にして返す', async () => {
      // 要求先の URL を検証するため、stubAgentFetch が渡す引数の型を mock.calls に持たせる
      const search = vi.fn<
        (init: RequestInit | undefined, requested: string) => Response
      >(
        () =>
          new Response(
            JSON.stringify({
              results: [
                {
                  title: 'Next.js 16',
                  url: 'https://nextjs.org/blog/next-16',
                  content: 'Next.js 16 is now available.',
                },
              ],
              unresponsive_engines: [['duckduckgo', 'CAPTCHA']],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
      );
      stubAgentFetch(webSearchCall('Next.js 16'), search);

      const events = await runAgent();

      expect(toolResultOf(events, 'web_search')).toMatchObject({
        result: [
          '"Next.js 16" の検索結果 (上位1件):\n',
          '[1] Next.js 16',
          '    URL: https://nextjs.org/blog/next-16',
          '    Next.js 16 is now available.',
          '',
        ].join('\n'),
        isError: false,
        summary: '1 件',
      });
      // 保存される記録（done の toolCalls）にも要約が載る（#150）
      expect(events.at(-1)).toMatchObject({
        type: 'done',
        metadata: {
          toolCalls: [{ name: 'web_search', isError: false, summary: '1 件' }],
        },
      });
      // 接続先は SEARXNG_URL の既定値。JSON の API をクエリ付きで呼ぶ
      // このファイルの URL 定数（/api/chat の URL）が組み込みの URL を隠しているため globalThis から使う
      const requested = new globalThis.URL(search.mock.calls[0][1]);
      expect(requested.origin + requested.pathname).toBe(
        'http://localhost:8888/search'
      );
      expect(requested.searchParams.get('q')).toBe('Next.js 16');
      expect(requested.searchParams.get('format')).toBe('json');
    });
  });

  describe('準正常系', () => {
    it('Content-Length なしで 2MiB を超える本文は受信を打ち切り、サイズ超過エラーを返す', async () => {
      const { res, observed } = endlessTextResponse({
        'content-type': 'text/plain',
      });
      stubAgentFetch(urlFetchCall(TARGET_URL), () => res);

      const events = await runAgent();

      expect(toolResultOf(events)).toMatchObject({
        result: 'エラー: ページが大きすぎます（2MB 超）。',
        isError: true,
      });
      expect(observed.cancelled).toBe(true);
      // 上限（2 MiB）を超えた直後で止まり、それ以上受信しない（read-ahead の 1 チャンク分を許容）
      const maxPulls = (2 * 1024 * 1024) / observed.chunkBytes + 2;
      expect(observed.pulls).toBeLessThanOrEqual(maxPulls);
    });

    it('Content-Length を小さく偽った本文も実受信量で打ち切る', async () => {
      const { res, observed } = endlessTextResponse({
        'content-type': 'text/plain',
        'content-length': '100',
      });
      stubAgentFetch(urlFetchCall(TARGET_URL), () => res);

      const events = await runAgent();

      expect(toolResultOf(events).result).toBe(
        'エラー: ページが大きすぎます（2MB 超）。'
      );
      expect(observed.cancelled).toBe(true);
    });

    it('web_search は 1MiB を超える検索結果ページの受信を打ち切り、リトライしない', async () => {
      const { res, observed } = endlessTextResponse({
        'content-type': 'text/html',
      });
      const search = vi.fn(() => res);
      stubAgentFetch(webSearchCall('Next.js'), search);

      const events = await runAgent();

      expect(toolResultOf(events, 'web_search').result).toBe(
        'エラー: 検索結果が大きすぎます（1MB 超）'
      );
      expect(observed.cancelled).toBe(true);
      // サイズ超過は再試行しても同じ結果になるため 1 回で諦める
      expect(search).toHaveBeenCalledTimes(1);
    });

    it('web_search の失敗は isError: true と理由の要約で届き、モデルへは「エラー: 」の文章を返す（#150）', async () => {
      const fetchMock = stubAgentFetch(
        webSearchCall('php 2025'),
        () => new Response('Forbidden', { status: 403 })
      );

      const events = await runAgent();

      const reason =
        'SearXNG が JSON の応答を返しません（HTTP 403）。searxng/settings.yml の search.formats に json があるか確認してください。';
      expect(toolResultOf(events, 'web_search')).toMatchObject({
        result: `エラー: ${reason}`,
        isError: true,
        summary: reason,
      });
      // 2 回目の Ollama への問い合わせ（最終回答）に、ツールの結果が従来と同じ文章で入る
      const ollamaBodies = fetchMock.mock.calls
        .filter(([requested]) => String(requested).endsWith('/api/chat'))
        .map(([, init]) => JSON.parse(String(init?.body)));
      expect(ollamaBodies[1].messages.at(-1)).toEqual({
        role: 'tool',
        content: `エラー: ${reason}`,
      });
    });

    it('web_search はすべての検索エンジンが応答したうえでの 0 件を、失敗ではなく空の結果として返す（#150）', async () => {
      stubAgentFetch(
        webSearchCall('php 2025'),
        () =>
          new Response(JSON.stringify({ results: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
      );

      const events = await runAgent();

      expect(toolResultOf(events, 'web_search')).toMatchObject({
        result: '"php 2025" の検索結果が見つかりませんでした。',
        isError: false,
        summary: '0 件',
        isEmpty: true,
      });
    });

    it('web_search は SearXNG に接続できなければ、起動の手順を返してリトライしない', async () => {
      const search = vi.fn(() => {
        // Node の fetch（undici）が接続を拒否されたときに投げる形
        throw new TypeError('fetch failed', {
          cause: Object.assign(
            new Error('connect ECONNREFUSED 127.0.0.1:8888'),
            {
              code: 'ECONNREFUSED',
            }
          ),
        });
      });
      stubAgentFetch(webSearchCall('php 2025'), search);

      const events = await runAgent();

      expect(toolResultOf(events, 'web_search').result).toBe(
        'エラー: SearXNG（http://localhost:8888）に接続できません。プロジェクトのルートで `docker compose up -d` を実行して起動してください。起動するまで、検索し直しても結果は得られません。'
      );
      // 起動していなければ再試行しても変わらないため 1 回で諦める
      expect(search).toHaveBeenCalledTimes(1);
    });

    it('web_search は SearXNG の JSON の API が無効（403）なら、設定の直し方を返してリトライしない', async () => {
      const search = vi.fn(() => new Response('Forbidden', { status: 403 }));
      stubAgentFetch(webSearchCall('php 2025'), search);

      const events = await runAgent();

      expect(toolResultOf(events, 'web_search').result).toBe(
        'エラー: SearXNG が JSON の応答を返しません（HTTP 403）。searxng/settings.yml の search.formats に json があるか確認してください。'
      );
      expect(search).toHaveBeenCalledTimes(1);
    });

    it('web_search は 0 件で検索エンジンが応答しなかったとき、0 件ではなく失敗として返す', async () => {
      stubAgentFetch(
        webSearchCall('php 2025'),
        () =>
          new Response(
            JSON.stringify({
              results: [],
              unresponsive_engines: [['duckduckgo', 'CAPTCHA']],
            }),
            { status: 200 }
          )
      );

      const events = await runAgent();

      expect(toolResultOf(events, 'web_search')).toMatchObject({
        result:
          'エラー: "php 2025" の検索で、検索エンジンが応答しませんでした（duckduckgo）。今は検索できないため、この応答の中で検索し直さず、検索できなかったことを伝えたうえで回答してください。',
        isError: true,
      });
    });

    it.each([
      ['プライベート IP', 'http://192.168.1.1/'],
      ['localhost', 'http://localhost:3000/'],
    ])(
      '%s はSSRF 防止で取得せず、禁止アドレスのエラーを返す',
      async (_label, url) => {
        const target = vi.fn(() => new Response('内部の秘密'));
        stubAgentFetch(urlFetchCall(url), target);

        const events = await runAgent();

        const { result } = toolResultOf(events);
        expect(result).toMatch(
          /^エラー: アクセスが禁止されているアドレス範囲です/
        );
        expect(result).not.toContain('内部の秘密');
        expect(target).not.toHaveBeenCalled();
      }
    );
  });

  describe('異常系', () => {
    it('本文が止まったままならツールタイムアウトで打ち切り、fetch と本文読み取りも中断する', async () => {
      const observed = { cancelled: false };
      let fetchSignal: AbortSignal | undefined;
      stubAgentFetch(urlFetchCall(TARGET_URL), (init) => {
        fetchSignal = init?.signal ?? undefined;
        let sent = false;
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (!sent) {
                sent = true;
                controller.enqueue(new TextEncoder().encode('先頭だけ'));
                return;
              }
              // 解決しない Promise を返し、本文を終端しない slow response を模す
              return new Promise<void>(() => {});
            },
            cancel() {
              observed.cancelled = true;
            },
          }),
          { status: 200, headers: { 'content-type': 'text/plain' } }
        );
      });

      const events = await runAgent();

      expect(toolResultOf(events)).toMatchObject({
        result: `ツール "url_fetch" がタイムアウトしました (${TOOL_TIMEOUT_MS}ms)`,
        isError: true,
      });
      // 応答を返すだけでなく、背後の通信と本文読み取りが止まっていること
      expect(fetchSignal?.aborted).toBe(true);
      expect(observed.cancelled).toBe(true);
    });

    it('web_search のリトライ待機中にツールタイムアウトが来たら、以降の再試行を行わない', async () => {
      // 5xx はリトライ対象（待機 1 秒）。待機はツールタイムアウト（300ms）より長いため、
      // 中断が待機に伝わらなければタイムアウト後に 2 回目以降の検索が走る
      const search = vi.fn(() => new Response('', { status: 503 }));
      stubAgentFetch(webSearchCall('Next.js'), search);

      const events = await runAgent();

      expect(toolResultOf(events, 'web_search')).toMatchObject({
        result: `ツール "web_search" がタイムアウトしました (${TOOL_TIMEOUT_MS}ms)`,
        isError: true,
        summary: `ツール "web_search" がタイムアウトしました (${TOOL_TIMEOUT_MS}ms)`,
      });
      // 中断されなかった場合に 2 回目が走るはずの時刻（最初の待機 1 秒）を過ぎるまで待ってから確かめる
      await new Promise((r) => setTimeout(r, 1200));
      expect(search).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * Ollama がラウンドごとに 1 つずつツールを呼び、呼び終えたら最終回答を返す fetch スタブ。
 * ツールの接続先（SearXNG・取得先）への fetch は `target` が返す。
 *
 * @param calls - 1 ラウンド目・2 ラウンド目…に LLM が要求するツール呼び出し
 * @param target - ツールの接続先への fetch に返すレスポンス
 * @returns スタブした fetch のモック関数
 */
function stubToolRounds(
  calls: ToolCallSpec[],
  target: (init: RequestInit | undefined, requested: string) => Response
) {
  let ollamaCalls = 0;
  return stubFetch((requested, init) => {
    if (requested.endsWith('/api/chat')) {
      const call = calls[ollamaCalls++];
      return call
        ? ollamaToolCallResponse(call)
        : ollamaStreamResponse(['完了']);
    }
    return target(init, requested);
  });
}

/**
 * Ollama への問い合わせの本文（送った履歴）を、問い合わせ順に取り出す。
 *
 * @param fetchMock - スタブした fetch のモック関数
 * @returns 各問い合わせの本文（JSON を解析したもの）
 */
function ollamaRequestBodies(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls
    .filter(([requested]) => String(requested).endsWith('/api/chat'))
    .map(([, init]) => JSON.parse(String(init?.body)));
}

/**
 * イベント列から tool_call_result を受信順に取り出す。
 *
 * @param events - `runAgent` が返したイベント列
 * @returns ツールの実行結果イベント
 */
function toolResultsOf(events: AgentStreamEvent[]) {
  return events.filter(
    (e): e is Extract<AgentStreamEvent, { type: 'tool_call_result' }> =>
      e.type === 'tool_call_result'
  );
}

/** SearXNG がすべての検索エンジンの無応答で 0 件を返す応答 */
const unresponsiveSearch = () =>
  new Response(
    JSON.stringify({
      results: [],
      unresponsive_engines: [
        ['brave', 'Suspended: too many requests'],
        ['google cse', 'Suspended: too many requests'],
      ],
    }),
    { status: 200 }
  );

/** 先に使えないとわかったツールを呼び直したときの見出しの要約 */
const SKIPPED_SUMMARY =
  '実行しませんでした（先の呼び出しで使えないとわかったため）';

describe('POST /api/chat（エージェント・使えないツールの呼び直し）', () => {
  // 契約: ツールが接続先ごと使えない失敗を返したら、同じ応答の中ではそのツールを再び実行しない。
  // モデルは失敗を伝えても言い換えて呼び直し続けるため（#157）
  describe('正常系', () => {
    it('web_search が成功していれば、続けて呼ばれた検索も実行する', async () => {
      const search = vi.fn(
        () =>
          new Response(
            JSON.stringify({
              results: [{ title: 'Java', url: 'https://www.java.com/' }],
            }),
            { status: 200 }
          )
      );
      stubToolRounds(
        [webSearchCall('Java 最新'), webSearchCall('OpenJDK 最新')],
        search
      );

      const events = await runAgent();

      expect(search).toHaveBeenCalledTimes(2);
      expect(toolResultsOf(events).map((e) => e.summary)).toEqual([
        '1 件',
        '1 件',
      ]);
    });
  });

  describe('準正常系', () => {
    it('検索エンジンがすべて応答しなければ、同じ応答の中の 2 回目以降の検索は SearXNG を呼ばず、実行しなかったことを返す', async () => {
      const search = vi.fn(unresponsiveSearch);
      const fetchMock = stubToolRounds(
        [
          webSearchCall('Java 最新バージョン'),
          webSearchCall('OpenJDK latest version'),
          webSearchCall('Java release'),
        ],
        search
      );

      const events = await runAgent();

      expect(search).toHaveBeenCalledTimes(1);
      const [first, ...skipped] = toolResultsOf(events);
      expect(first).toMatchObject({ isError: true });
      expect(first.result).toMatch(/この応答の中で検索し直さず/);
      expect(skipped).toHaveLength(2);
      for (const result of skipped) {
        expect(result).toMatchObject({
          isError: true,
          summary: SKIPPED_SUMMARY,
        });
      }
      // モデルへは、実行しなかったことと、先に失敗した理由を返す
      const bodies = ollamaRequestBodies(fetchMock);
      expect(bodies[2].messages.at(-1)).toEqual({
        role: 'tool',
        content: `エラー: web_search は、この応答の中で先に使えないとわかったため実行しませんでした（${first.summary}）。この応答ではこのツールを呼ばず、ここまでの情報で回答してください。`,
      });
      // 実行しなかった呼び出しも記録に残す（画面に ❌ で出し、保存する）
      expect(events.at(-1)).toMatchObject({
        type: 'done',
        metadata: {
          toolCalls: [
            { name: 'web_search', isError: true },
            { name: 'web_search', summary: SKIPPED_SUMMARY, durationMs: 0 },
            { name: 'web_search', summary: SKIPPED_SUMMARY, durationMs: 0 },
          ],
        },
      });
    });

    it('接続先ごと使えない印は、画面へのイベントにも保存する記録にも含めない', async () => {
      stubToolRounds([webSearchCall('Java 最新')], unresponsiveSearch);

      const events = await runAgent();

      expect(JSON.stringify(events)).not.toContain('unavailable');
    });

    it('url_fetch の失敗は URL ごとに変わるため、続けて呼ばれた取得は実行する', async () => {
      const target = vi.fn(() => new Response('Forbidden', { status: 403 }));
      stubToolRounds(
        [urlFetchCall(TARGET_URL), urlFetchCall('http://203.0.113.11/other')],
        target
      );

      const events = await runAgent();

      expect(target).toHaveBeenCalledTimes(2);
      expect(toolResultsOf(events).map((e) => e.summary)).not.toContain(
        SKIPPED_SUMMARY
      );
    });
  });

  describe('異常系', () => {
    it('SearXNG に接続できなければ、同じ応答の中の 2 回目の検索は実行しない', async () => {
      const search = vi.fn(() => {
        // Node の fetch（undici）が接続を拒否されたときに投げる形
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error('connect ECONNREFUSED'), {
            code: 'ECONNREFUSED',
          }),
        });
      });
      stubToolRounds(
        [webSearchCall('Java 最新'), webSearchCall('OpenJDK 最新')],
        search
      );

      const events = await runAgent();

      expect(search).toHaveBeenCalledTimes(1);
      expect(toolResultsOf(events).at(-1)).toMatchObject({
        isError: true,
        summary: SKIPPED_SUMMARY,
      });
      expect(events.at(-1)?.type).toBe('done');
    });
  });
});

/**
 * Ollama への問い合わせごとに、用意した応答を順に返す fetch スタブ。
 *
 * @param responses - 1 回目・2 回目…の問い合わせに返す応答を作る関数
 * @returns スタブした fetch のモック関数
 */
function stubOllamaSequence(responses: (() => Response)[]) {
  let calls = 0;
  return stubFetch(() => responses[calls++]());
}

describe('POST /api/chat（エージェント・思考過程）', () => {
  describe('正常系', () => {
    it('message.thinking の断片を 1 つの thinking イベントにまとめ、本文より先に流す', async () => {
      stubOllamaSequence([
        () =>
          ollamaChunksResponse([
            { thinking: 'The user' },
            { thinking: ' says hi.' },
            { content: 'こんにちは' },
          ]),
      ]);

      const events = await runAgent();

      // 断片ごとに trim されると単語間の空白が消える（'The usersays hi.'）ため、まとめて流す
      expect(events.filter((e) => e.type === 'thinking')).toEqual([
        { type: 'thinking', content: 'The user says hi.' },
      ]);
      expect(events.map((e) => e.type)).toEqual([
        'thinking',
        'text_delta',
        'done',
      ]);
    });

    it('ツール呼び出しのラウンドの思考過程も、ラウンドごとに thinking イベントになる', async () => {
      stubOllamaSequence([
        () =>
          ollamaChunksResponse([
            { thinking: '時刻を調べる' },
            {
              tool_calls: [
                { function: { name: 'get_current_datetime', arguments: {} } },
              ],
            },
          ]),
        () =>
          ollamaChunksResponse([{ thinking: '答える' }, { content: '今です' }]),
      ]);

      const events = await runAgent();

      expect(events.map((e) => e.type)).toEqual([
        'thinking',
        'tool_call_start',
        'tool_call_result',
        'thinking',
        'text_delta',
        'done',
      ]);
      expect(
        events.flatMap((e) => (e.type === 'thinking' ? [e.content] : []))
      ).toEqual(['時刻を調べる', '答える']);
    });

    it('Ollama に think を送らず、思考するかはモデルの既定に任せる', async () => {
      const fetchMock = stubOllamaSequence([
        () => ollamaStreamResponse(['完了']),
      ]);

      await runAgent();

      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init!.body as string)).not.toHaveProperty('think');
    });
  });

  describe('準正常系', () => {
    it('本文なしで思考過程だけが返っても thinking イベントを流して完了する', async () => {
      stubOllamaSequence([
        () => ollamaChunksResponse([{ thinking: '考えた' }]),
      ]);

      const events = await runAgent();

      expect(events).toEqual([
        { type: 'thinking', content: '考えた' },
        expect.objectContaining({ type: 'done' }),
      ]);
    });

    it('本文中の <think> タグの思考過程も、従来どおり thinking イベントになる', async () => {
      stubOllamaSequence([
        () => ollamaStreamResponse(['<think>考え', 'た</think>', '答え']),
      ]);

      const events = await runAgent();

      expect(events.filter((e) => e.type === 'thinking')).toEqual([
        { type: 'thinking', content: '考えた' },
      ]);
      expect(
        events.flatMap((e) => (e.type === 'text_delta' ? [e.content] : []))
      ).toEqual(['答え']);
    });
  });

  describe('異常系', () => {
    it('空白だけの思考過程は thinking イベントにしない', async () => {
      stubOllamaSequence([
        () => ollamaChunksResponse([{ thinking: ' \n ' }, { content: '答え' }]),
      ]);

      const events = await runAgent();

      expect(events.map((e) => e.type)).toEqual(['text_delta', 'done']);
    });
  });
});

describe('POST /api/chat（エージェント・現在の日時）', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('正常系', () => {
    it('先頭の system メッセージに、現在の日時と検索語の年の指示を入れる（#154）', async () => {
      // Date だけを偽る（タイマーまで偽るとストリームの読み取りが進まない）。
      // UTC 03:00 は UTC-3〜UTC+14 のどこでも 1 月 15 日のため、実行環境のタイムゾーンに左右されない
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2025-01-15T03:00:00Z'));
      const fetchMock = stubOllamaSequence([
        () => ollamaStreamResponse(['完了']),
      ]);

      await runAgent();

      const [, init] = fetchMock.mock.calls[0];
      const [system] = JSON.parse(init!.body as string).messages;
      expect(system.role).toBe('system');
      expect(system.content).toMatch(/^## 現在の日時\n2025年1月15日/);
      expect(system.content).toContain(
        '検索語に年を入れる場合は、この日時の年を使うこと'
      );
    });
  });
});
