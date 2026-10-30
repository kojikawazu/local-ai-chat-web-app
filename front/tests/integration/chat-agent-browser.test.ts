import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  vi,
} from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import type { NextRequest } from 'next/server';
import type { AgentStreamEvent } from '@/lib/agent/tools/types';
import type { OllamaChatMessage } from '@/lib/llm/ollama';
import {
  activeBrowserSessions,
  closeBrowser,
} from '@/lib/agent/tools/browser/browser';
import { jsonRequest } from './helpers/db';
import { ollamaStreamResponse, stubFetch } from './helpers/ollama-stub';

/**
 * `/api/chat`（エージェント経路）でのブラウザのツール（#149。`docs/18-browser-tools.md`）の IT。
 *
 * 実際の Chromium（`pnpm exec playwright install chromium`）で、テストの中で起こした HTTP サーバーを開く。
 * 許可したサーバー（A・C。`BROWSER_LOCAL_ORIGINS`）と、許可していないサーバー（B）を立て、B に 1 度も
 * リクエストが届かないことで、転送の先・ページの中のリクエストもプロキシが止めることを確かめる。
 * Ollama（真の外部）だけを fetch スタブで差し替える。公開の Web には触れない。この経路は DB を使わない。
 */

/** LLM が要求するツール呼び出し（ツール名と引数） */
type ToolCallSpec = { name: string; arguments: Record<string, unknown> };

/** Ollama の /api/chat に送られたリクエストのボディ（確かめる部分だけ） */
type ChatRequestBody = {
  messages: OllamaChatMessage[];
  tools?: { function: { name: string } }[];
};

/** 許可していないサーバー B に届いたリクエスト（HTTP・WebSocket） */
const forbiddenHits: string[] = [];

let serverA: http.Server;
let serverB: http.Server;
let serverC: http.Server;
let originA: string;
let originB: string;
let POST: (request: NextRequest) => Promise<Response>;
let GET_TOOLS: () => Promise<Response>;

/** 許可したサーバー A の確認用のページ。合言葉は JavaScript で描く（静的な HTML には無い） */
const PASSPHRASE_PAGE = `<!doctype html><html><head><title>確認用のページ</title></head><body>
<h1>確認用</h1><p id="secret"></p>
<script>document.getElementById('secret').textContent = '合言葉はペンギン42です';</script>
</body></html>`;

/** スナップショットの上限（12,000 文字）を超える長さの段落 */
const LONG_TEXT = 'A'.repeat(15_000);

/**
 * サーバーを 127.0.0.1 の空きポートで起動する。
 *
 * @param handler - リクエストの処理
 * @returns 起動したサーバー
 */
async function listen(handler: http.RequestListener): Promise<http.Server> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve())
  );
  return server;
}

/**
 * サーバーのオリジンを返す。
 *
 * @param server - 起動したサーバー
 * @returns `http://127.0.0.1:<port>`
 */
function originOf(server: http.Server): string {
  // listen(0, '127.0.0.1') の後の address() は AddressInfo（文字列になるのは UNIX ソケット・名前付きパイプのとき）
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/**
 * HTML を返す。
 *
 * @param res - 応答
 * @param html - 本文
 */
function sendHtml(res: http.ServerResponse, html: string): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

beforeAll(async () => {
  serverB = await listen((req, res) => {
    forbiddenHits.push(`http ${req.url}`);
    res.end('秘密の内容');
  });
  serverB.on('upgrade', (req, socket) => {
    forbiddenHits.push(`ws ${req.url}`);
    socket.destroy();
  });
  originB = originOf(serverB);

  serverC = await listen((_req, res) => {
    res.writeHead(302, { location: `${originB}/from-c` });
    res.end();
  });

  serverA = await listen((req, res) => {
    switch (req.url) {
      case '/':
        return sendHtml(res, PASSPHRASE_PAGE);
      case '/long':
        return sendHtml(res, `<title>長いページ</title><p>${LONG_TEXT}</p>`);
      case '/to-b':
        res.writeHead(302, { location: `${originB}/from-a` });
        return res.end();
      case '/to-c':
        res.writeHead(302, { location: `${originOf(serverC)}/` });
        return res.end();
      case '/fetch-b':
        return sendHtml(
          res,
          `<title>待機中</title><script>fetch('${originB}/api').then((r) => r.text()).then((t) => { document.title = '取得:' + t; }).catch(() => { document.title = '取得できなかった'; });</script>`
        );
      case '/ws-b':
        return sendHtml(
          res,
          `<title>待機中</title><script>const ws = new WebSocket('${originB.replace('http', 'ws')}/socket'); ws.onopen = () => { document.title = '接続した'; }; ws.onerror = () => { document.title = '接続できなかった'; };</script>`
        );
      case '/slow':
        // 応答しない（停止の確認用）
        return;
      default:
        res.writeHead(404).end();
    }
  });
  originA = originOf(serverA);

  vi.stubEnv('BROWSER_ENABLED', 'true');
  // A は localhost の書き方でも許可する（localhost は ::1 が先に引けるが、A は 127.0.0.1 だけで待ち受ける）
  vi.stubEnv(
    'BROWSER_LOCAL_ORIGINS',
    `${originA},${originA.replace('127.0.0.1', 'localhost')},${originOf(serverC)}`
  );
  // registry.ts は環境変数を初めて使うときに読むため、設定してから route を読み込む（ファイルごとにモジュールは隔離される）
  ({ POST } = await import('@/app/api/chat/route'));
  ({ GET: GET_TOOLS } = await import('@/app/api/tools/route'));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await closeBrowser();
  for (const server of [serverA, serverB, serverC]) {
    server.closeAllConnections();
    server.close();
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  forbiddenHits.length = 0;
});

/**
 * ツール呼び出しを要求する Ollama の応答を作る（tool_calls は done=true のチャンクに含まれる）。
 *
 * @param calls - LLM が同時に要求するツール呼び出し
 * @returns NDJSON の `Response`
 */
function ollamaToolCallResponse(calls: ToolCallSpec[]): Response {
  const line = JSON.stringify({
    model: 'test',
    message: {
      role: 'assistant',
      content: '',
      tool_calls: calls.map((call) => ({ function: call })),
    },
    done: true,
  });
  return new Response(line + '\n', {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' },
  });
}

/** {@link runAgent} の指定。 */
type RunOptions = {
  /** モデルが画像を読めるか（`/api/show` の capabilities に vision を入れるか）。既定は true */
  vision?: boolean;
  /** `/api/chat` のリクエストの URL（アプリ自身のオリジンを変えるとき） */
  url?: string;
  /** 送信を中断する signal */
  signal?: AbortSignal;
};

/**
 * Ollama の応答をラウンドごとに決めてスタブし、エージェント経路で送信して NDJSON のイベント列を読み切る。
 * ラウンドを使い切ったら最終回答のテキストを返す。
 *
 * @param rounds - ラウンドごとに LLM が要求するツール呼び出し
 * @param options - モデルの対応機能・リクエストの URL・中断
 * @returns 受信したイベントと、Ollama の /api/chat に送られたボディ（順に）
 */
async function runAgent(
  rounds: ToolCallSpec[][],
  options: RunOptions = {}
): Promise<{ events: AgentStreamEvent[]; chatBodies: ChatRequestBody[] }> {
  const chatBodies: ChatRequestBody[] = [];
  let ollamaCalls = 0;
  stubFetch((requested, init) => {
    if (requested.endsWith('/api/show')) {
      return Response.json({
        capabilities:
          options.vision === false
            ? ['completion', 'tools']
            : ['completion', 'tools', 'vision'],
      });
    }
    chatBodies.push(JSON.parse(String(init?.body)) as ChatRequestBody);
    const calls = rounds[ollamaCalls++];
    return calls
      ? ollamaToolCallResponse(calls)
      : ollamaStreamResponse(['完了']);
  });
  const res = await POST(
    jsonRequest(
      options.url ?? 'http://localhost/api/chat',
      'POST',
      { message: 'ページを見て', enableTools: true },
      options.signal
    )
  );
  expect(res.status).toBe(200);
  const events = (await res.text())
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as AgentStreamEvent);
  return { events, chatBodies };
}

/**
 * イベント列から、ツールの実行結果を順に取り出す。
 *
 * @param events - イベント列
 * @param name - ツール名
 * @returns そのツールの tool_call_result（呼んだ順）
 */
function resultsOf(events: AgentStreamEvent[], name: string) {
  return events.filter(
    (event): event is Extract<AgentStreamEvent, { type: 'tool_call_result' }> =>
      event.type === 'tool_call_result' && event.name === name
  );
}

/**
 * ページを開く呼び出しを作る。
 *
 * @param url - 開く URL
 * @returns ツール呼び出し
 */
function navigate(url: string): ToolCallSpec {
  return { name: 'browser_navigate', arguments: { url } };
}

describe('POST /api/chat（ブラウザのツール）', () => {
  describe('正常系', () => {
    it('ページを開き、JavaScript で描いた内容をスナップショットで返す', async () => {
      const { events } = await runAgent([[navigate(`${originA}/`)]]);
      const [result] = resultsOf(events, 'browser_navigate');
      expect(result.isError).toBe(false);
      expect(result.result).toContain('合言葉はペンギン42です');
      expect(result.result).toContain('HTTP の状態: 200');
      expect(result.summary).toBe(`確認用のページ（${new URL(originA).host}）`);
      // 後始末はストリームを閉じた後に行うため、少し遅れて返る
      await vi.waitFor(() => expect(activeBrowserSessions()).toBe(0));
    });

    it('localhost の書き方でも、127.0.0.1 だけで待ち受けるサーバーを開ける', async () => {
      const { events } = await runAgent([
        [navigate(`${originA.replace('127.0.0.1', 'localhost')}/`)],
      ]);
      const [result] = resultsOf(events, 'browser_navigate');
      expect(result.isError).toBe(false);
      expect(result.result).toContain('合言葉はペンギン42です');
    });

    it('長いページは先頭で切り、browser_snapshot の offset で続きを読む', async () => {
      const { events } = await runAgent([
        [navigate(`${originA}/long`)],
        [{ name: 'browser_snapshot', arguments: { offset: 12000 } }],
      ]);
      const [first] = resultsOf(events, 'browser_navigate');
      expect(first.result).toContain('offset に 12000 を指定して読めます');
      const [rest] = resultsOf(events, 'browser_snapshot');
      expect(rest.isError).toBe(false);
      expect(rest.result).toContain('ここで終わりです');
    });

    it('スクリーンショットは画像としてツールのメッセージに付け、画面・記録には出さない', async () => {
      const { events, chatBodies } = await runAgent([
        [navigate(`${originA}/`)],
        [{ name: 'browser_screenshot', arguments: {} }],
      ]);
      const [shot] = resultsOf(events, 'browser_screenshot');
      expect(shot.isError).toBe(false);
      expect(shot.summary).toBe(`1280×800（${new URL(originA).host}）`);
      expect(shot).not.toHaveProperty('images');

      // 3 回目の問い合わせ（最終回答）の履歴の末尾が、画像付きのツールのメッセージ
      const toolMessage = chatBodies[2].messages.at(-1);
      expect(toolMessage?.role).toBe('tool');
      expect(toolMessage?.images).toHaveLength(1);
      // PNG の先頭（\x89PNG）を Base64 にしたもの
      expect(toolMessage?.images?.[0].startsWith('iVBORw0KGgo')).toBe(true);
      // 画像はモデルへ渡すだけで、完了の記録（DB に保存される）には入らない
      const done = events.find((event) => event.type === 'done');
      expect(JSON.stringify(done)).not.toContain('iVBORw0KGgo');
    });

    it('ツールの一覧に 3 つが出る', async () => {
      const { tools } = await (await GET_TOOLS()).json();
      expect(tools.map((tool: { name: string }) => tool.name)).toEqual(
        expect.arrayContaining([
          'browser_navigate',
          'browser_snapshot',
          'browser_screenshot',
        ])
      );
    });
  });

  describe('準正常系', () => {
    it('許可したサーバーから、許可していないサーバーへの転送を止める', async () => {
      const { events } = await runAgent([[navigate(`${originA}/to-b`)]]);
      const [result] = resultsOf(events, 'browser_navigate');
      expect(result.isError).toBe(true);
      expect(result.summary).toContain('転送の先');
      expect(forbiddenHits).toEqual([]);
    });

    it('許可したサーバーを経由する転送の連鎖（A → C → B）も止める', async () => {
      const { events } = await runAgent([[navigate(`${originA}/to-c`)]]);
      expect(resultsOf(events, 'browser_navigate')[0].isError).toBe(true);
      expect(forbiddenHits).toEqual([]);
    });

    it('ページの中から許可していないサーバーへの fetch を止める', async () => {
      const { events } = await runAgent([[navigate(`${originA}/fetch-b`)]]);
      const [result] = resultsOf(events, 'browser_navigate');
      expect(result.result).toContain('タイトル: 取得できなかった');
      expect(forbiddenHits).toEqual([]);
    });

    it('ページの中から許可していないサーバーへの WebSocket を止める', async () => {
      const { events } = await runAgent([[navigate(`${originA}/ws-b`)]]);
      const [result] = resultsOf(events, 'browser_navigate');
      expect(result.result).toContain('タイトル: 接続できなかった');
      expect(forbiddenHits).toEqual([]);
    });

    it('画像を読めないモデルにはスクリーンショットを渡さず、呼ばれても実行しない', async () => {
      const { events, chatBodies } = await runAgent(
        [
          [navigate(`${originA}/`)],
          [{ name: 'browser_screenshot', arguments: {} }],
        ],
        { vision: false }
      );
      const offered = chatBodies[0].tools?.map((tool) => tool.function.name);
      expect(offered).toContain('browser_navigate');
      expect(offered).not.toContain('browser_screenshot');
      const [shot] = resultsOf(events, 'browser_screenshot');
      expect(shot.isError).toBe(true);
      expect(shot.result).toContain('browser_snapshot');
      expect(chatBodies[2].messages.at(-1)?.images).toBeUndefined();
    });

    it('手元の開発サーバーのページを読んだ後は、外部と通信するツールを実行しない', async () => {
      const { events } = await runAgent([
        [navigate(`${originA}/`)],
        [
          { name: 'url_fetch', arguments: { url: 'https://example.com/' } },
          navigate('https://example.com/'),
        ],
      ]);
      const [fetched] = resultsOf(events, 'url_fetch');
      expect(fetched.isError).toBe(true);
      expect(fetched.result).toContain('実行しませんでした');
      const [, publicPage] = resultsOf(events, 'browser_navigate');
      expect(publicPage.isError).toBe(true);
      expect(publicPage.result).toContain('実行しませんでした');
    });

    it('ページを開く前の読み直し・スクリーンショットは失敗にする', async () => {
      const { events } = await runAgent([
        [
          { name: 'browser_snapshot', arguments: {} },
          { name: 'browser_screenshot', arguments: {} },
        ],
      ]);
      for (const name of ['browser_snapshot', 'browser_screenshot']) {
        expect(resultsOf(events, name)[0].summary).toBe(
          '先に browser_navigate でページを開いてください'
        );
      }
      // 後始末はストリームを閉じた後に行うため、少し遅れて返る
      await vi.waitFor(() => expect(activeBrowserSessions()).toBe(0));
    });
  });

  describe('異常系', () => {
    it('許可していないプライベートのアドレスは開かない', async () => {
      const { events } = await runAgent([[navigate(`${originB}/`)]]);
      const [result] = resultsOf(events, 'browser_navigate');
      expect(result.isError).toBe(true);
      expect(result.summary).toContain('BROWSER_LOCAL_ORIGINS');
      expect(forbiddenHits).toEqual([]);
    });

    it('file: の URL は開かない', async () => {
      const { events } = await runAgent([[navigate('file:///etc/passwd')]]);
      expect(resultsOf(events, 'browser_navigate')[0].summary).toContain(
        'http:// または https://'
      );
    });

    it('このアプリ自身は、許可したオリジンでも開かない', async () => {
      const { events } = await runAgent([[navigate(`${originA}/`)]], {
        url: `${originA}/api/chat`,
      });
      expect(resultsOf(events, 'browser_navigate')[0].summary).toBe(
        'このアプリ自身は開けません'
      );
    });

    it('ページを開いている途中で停止したら、読み込みを止めてセッションを返す', async () => {
      const controller = new AbortController();
      const running = runAgent([[navigate(`${originA}/slow`)]], {
        signal: controller.signal,
      });
      // ページの読み込みが始まるまで待ってから止める
      await vi.waitFor(() => expect(activeBrowserSessions()).toBe(1), {
        timeout: 10_000,
      });
      controller.abort();
      const { events } = await running;
      expect(events.some((event) => event.type === 'done')).toBe(false);
      await vi.waitFor(() => expect(activeBrowserSessions()).toBe(0));
    });
  });
});
