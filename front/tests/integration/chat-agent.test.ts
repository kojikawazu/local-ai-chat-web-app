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
import { ollamaStreamResponse, stubFetch } from './helpers/ollama-stub';

/**
 * `/api/chat`（エージェント経路・`url_fetch` / `web_search`）の IT。
 *
 * 真の外部である Ollama と取得先 Web サーバー（任意 URL・DuckDuckGo）を fetch スタブで
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
 * @param target - 取得先への fetch に返すレスポンス（init から signal を観測できる）
 * @returns スタブした fetch のモック関数
 */
function stubAgentFetch(
  call: ToolCallSpec,
  target: (init?: RequestInit) => Response
) {
  let ollamaCalls = 0;
  return stubFetch((requested, init) => {
    if (requested.endsWith('/api/chat')) {
      ollamaCalls++;
      return ollamaCalls === 1
        ? ollamaToolCallResponse(call)
        : ollamaStreamResponse(['完了']);
    }
    return target(init);
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
  });

  describe('準正常系', () => {
    it('Content-Length なしで 2MiB を超える本文は受信を打ち切り、サイズ超過エラーを返す', async () => {
      const { res, observed } = endlessTextResponse({
        'content-type': 'text/plain',
      });
      stubAgentFetch(urlFetchCall(TARGET_URL), () => res);

      const events = await runAgent();

      expect(toolResultOf(events).result).toBe(
        'エラー: ページが大きすぎます（2MB 超）。'
      );
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
        'エラー: 検索結果ページが大きすぎます（1MB 超）'
      );
      expect(observed.cancelled).toBe(true);
      // サイズ超過は再試行しても同じ結果になるため 1 回で諦める
      expect(search).toHaveBeenCalledTimes(1);
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
      });
      // 中断されなかった場合に 2 回目が走るはずの時刻（最初の待機 1 秒）を過ぎるまで待ってから確かめる
      await new Promise((r) => setTimeout(r, 1200));
      expect(search).toHaveBeenCalledTimes(1);
    });
  });
});
