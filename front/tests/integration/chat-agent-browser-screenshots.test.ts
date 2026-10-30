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
import type { ToolScreenshot } from '@/types/agent/tool-call';
import { closeBrowser } from '@/lib/agent/tools/browser/browser';
import { MAX_TOOL_SCREENSHOTS_PER_MESSAGE } from '@/lib/shared/validation';
import { jsonRequest, routeContext } from './helpers/db';
import { ollamaStreamResponse, stubFetch } from './helpers/ollama-stub';

/**
 * ブラウザの操作の画面をチャットに出す（#200。`docs/18-browser-tools.md`「画面をチャットに出す」）の IT。
 *
 * 実際の Chromium で、テストの中で起こした HTTP サーバー（`BROWSER_LOCAL_ORIGINS`）のページを開き、`/api/chat`（エージェント経路）の
 * イベントに載る画面を確かめる: 承認の依頼の操作の前の画面（要素の位置付き）・結果の前と後の画面・`done` の記録に中身が無いこと・
 * 1 回の応答の枚数の上限。Ollama（真の外部）だけを fetch スタブで差し替える。保存は画面（`useChat`）が行うため、
 * 保存の API は attachments.test.ts・message-replace.test.ts が担う。この経路は DB を使わない。
 */

/** LLM が要求するツール呼び出し（ツール名と引数） */
type ToolCallSpec = { name: string; arguments: Record<string, unknown> };

/** 1 ラウンドで LLM が要求するツール呼び出し。前のツールの結果（呼んだ順）から決めるときは関数にする */
type Round = ToolCallSpec[] | ((toolResults: string[]) => ToolCallSpec[]);

/** ツールの実行結果のイベント */
type ResultEvent = Extract<AgentStreamEvent, { type: 'tool_call_result' }>;

/** 承認の依頼のイベント */
type ApprovalEvent = Extract<
  AgentStreamEvent,
  { type: 'tool_approval_request' }
>;

const CHAT_URL = 'http://localhost/api/chat';
const APPROVAL_URL = 'http://localhost/api/agent/approvals/x';
const VIEWPORT = { width: 1280, height: 800 };

let server: http.Server;
let origin: string;
let POST_CHAT: (request: NextRequest) => Promise<Response>;
let POST_APPROVAL: (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => Promise<Response>;

/** 上のボタンと、画面の外（下へ 2,000px）のボタンを置いたページ */
const PAGE = `<!doctype html><html lang="ja"><head><title>画面の確認</title></head><body>
<h1 id="state">まだ押していません</h1>
<button onclick="document.getElementById('state').textContent = '押しました'">押す</button>
<div style="height: 2000px"></div>
<button>下のボタン</button>
</body></html>`;

/** 承認を待つ間に、押すボタンの名前が「消す」に変わるページ（2.5 秒後） */
const CHANGING_PAGE = `<!doctype html><html lang="ja"><head><title>変わるページ</title></head><body>
<button>押す</button>
<script>setTimeout(() => { document.querySelector('button').textContent = '消す'; }, 2500);</script>
</body></html>`;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(req.url === '/changing' ? CHANGING_PAGE : PAGE);
  });
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve())
  );
  // listen(0, '127.0.0.1') の後の address() は AddressInfo（文字列になるのは UNIX ソケット・名前付きパイプのとき）
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  vi.stubEnv('BROWSER_ENABLED', 'true');
  vi.stubEnv('BROWSER_LOCAL_ORIGINS', origin);
  // registry.ts は環境変数を初めて使うときに読むため、設定してから route を読み込む（ファイルごとにモジュールは隔離される）
  ({ POST: POST_CHAT } = await import('@/app/api/chat/route'));
  ({ POST: POST_APPROVAL } =
    await import('@/app/api/agent/approvals/[id]/route'));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await closeBrowser();
  server.closeAllConnections();
  server.close();
});

afterEach(() => {
  vi.unstubAllGlobals();
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

/**
 * Ollama の応答をラウンドごとに決めてスタブし、エージェント経路で送信して NDJSON のイベント列を読み切る。
 * 承認の依頼が届いたら `approve` で許可・拒否を返す。ラウンドを使い切ったら最終回答のテキストを返す。
 *
 * @param rounds - ラウンドごとに LLM が要求するツール呼び出し
 * @param options - 承認の答え方（省略時はすぐに許可）と、画像を読めるモデルにするか
 * @param options.approve - 承認の依頼に許可するなら true
 * @param options.approveAfterMs - 承認の依頼を受けてから答えるまで待つ時間（ミリ秒）
 * @param options.vision - 画像を読めるモデルとして答えるなら true（`browser_screenshot` を使う）
 * @returns 受信したイベント（受信順）と、モデルへ渡ったツールの結果の画像（呼んだ順）
 */
async function runAgent(
  rounds: Round[],
  options: { approve?: boolean; approveAfterMs?: number; vision?: boolean } = {}
): Promise<{ events: AgentStreamEvent[]; toolImages: string[] }> {
  let ollamaCalls = 0;
  let toolImages: string[] = [];
  stubFetch((requested, init) => {
    if (requested.endsWith('/api/show')) {
      return Response.json({
        capabilities: [
          'completion',
          'tools',
          ...(options.vision ? ['vision'] : []),
        ],
      });
    }
    const body = JSON.parse(String(init?.body)) as {
      messages: (OllamaChatMessage & { images?: string[] })[];
    };
    const toolMessages = body.messages.filter(
      (message) => message.role === 'tool'
    );
    toolImages = toolMessages.flatMap((message) => message.images ?? []);
    const round = rounds[ollamaCalls++];
    if (!round) return ollamaStreamResponse(['完了']);
    return ollamaToolCallResponse(
      typeof round === 'function'
        ? round(toolMessages.map((message) => message.content))
        : round
    );
  });

  const res = await POST_CHAT(
    jsonRequest(CHAT_URL, 'POST', {
      message: 'ページを操作して',
      enableTools: true,
    })
  );
  expect(res.status).toBe(200);
  const reader = res.body!.getReader(); // 200 の NDJSON 応答は必ず本文を持つ
  const decoder = new TextDecoder();
  const events: AgentStreamEvent[] = [];
  let buffer = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines.filter((l) => l.trim())) {
      const event = JSON.parse(line) as AgentStreamEvent;
      events.push(event);
      if (event.type !== 'tool_approval_request') continue;
      if (options.approveAfterMs) {
        await new Promise((resolve) =>
          setTimeout(resolve, options.approveAfterMs)
        );
      }
      const decided = await POST_APPROVAL(
        jsonRequest(APPROVAL_URL, 'POST', {
          approved: options.approve ?? true,
        }),
        routeContext(event.approvalId)
      );
      expect(decided.status).toBe(204);
    }
  }
  return { events, toolImages };
}

/**
 * ページを開く呼び出しを作る。
 *
 * @param path - 開くパス
 * @returns browser_navigate の呼び出し
 */
function navigate(path = '/'): ToolCallSpec {
  return { name: 'browser_navigate', arguments: { url: `${origin}${path}` } };
}

/**
 * 最後のツールの結果（スナップショット）から参照を取り、クリックの呼び出しを作る。
 *
 * @param element - 押す要素の行の頭（`button "押す"`）
 * @returns 前のツールの結果から呼び出しを決めるラウンド
 */
function click(element: string): (toolResults: string[]) => ToolCallSpec[] {
  return (toolResults) => {
    const escaped = element.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ref = new RegExp(`${escaped}[^\\n]*?\\[ref=(\\w+)\\]`).exec(
      toolResults.at(-1) ?? ''
    )?.[1];
    if (!ref) throw new Error(`${element} の参照がありません`);
    return [{ name: 'browser_click', arguments: { ref } }];
  };
}

/**
 * イベント列から、ツールの実行結果を順に取り出す。
 *
 * @param events - イベント列
 * @param name - ツール名
 * @returns そのツールの tool_call_result（呼んだ順）
 */
function resultsOf(events: AgentStreamEvent[], name: string): ResultEvent[] {
  return events.filter(
    (event): event is ResultEvent =>
      event.type === 'tool_call_result' && event.name === name
  );
}

/**
 * イベント列から、最初の承認の依頼を取り出す。
 *
 * @param events - イベント列
 * @returns tool_approval_request
 */
function firstApproval(events: AgentStreamEvent[]): ApprovalEvent {
  const approval = events.find(
    (event): event is ApprovalEvent => event.type === 'tool_approval_request'
  );
  if (!approval) throw new Error('承認の依頼がありません');
  return approval;
}

/**
 * イベント列から、`done` の記録のうち指定したツールのスクリーンショットを取り出す。
 *
 * @param events - イベント列
 * @param name - ツール名
 * @returns 記録のスクリーンショット（呼んだ順のツールごと）
 */
function recordedShots(
  events: AgentStreamEvent[],
  name: string
): (ToolScreenshot[] | undefined)[] {
  const done = events.find(
    (event): event is Extract<AgentStreamEvent, { type: 'done' }> =>
      event.type === 'done'
  );
  return (done?.metadata?.toolCalls ?? [])
    .filter((call) => call.name === name)
    .map((call) => call.screenshots);
}

/**
 * スクリーンショットの中身の先頭が、その形式のシグネチャかを返す。
 *
 * @param shot - 中身付きのスクリーンショット
 * @returns JPEG なら `FF D8`、PNG なら `89 50 4E 47` で始まれば true
 */
function hasSignature(shot: ToolScreenshot): boolean {
  const bytes = Buffer.from(shot.data ?? '', 'base64');
  return shot.mimeType === 'image/jpeg'
    ? bytes[0] === 0xff && bytes[1] === 0xd8
    : bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
}

/**
 * 要素の位置が、画像の中に収まっているかを返す。
 *
 * @param shot - スクリーンショット
 * @returns 位置があり、画像の範囲に収まっていれば true
 */
function boxInside(shot: ToolScreenshot | undefined): boolean {
  const box = shot?.box;
  return (
    box !== undefined &&
    box.width > 0 &&
    box.height > 0 &&
    box.x + box.width <= VIEWPORT.width &&
    box.y + box.height <= VIEWPORT.height
  );
}

describe('正常系', () => {
  it('ページを開いた後の画面を JPEG で結果に載せ、done の記録には中身を入れない', async () => {
    const { events } = await runAgent([[navigate()]]);

    const [opened] = resultsOf(events, 'browser_navigate');
    expect(opened.isError).toBe(false);
    expect(opened.screenshots).toHaveLength(1);
    const [shot] = opened.screenshots ?? [];
    expect(shot).toMatchObject({
      kind: 'after',
      mimeType: 'image/jpeg',
      ...VIEWPORT,
    });
    expect(hasSignature(shot)).toBe(true);
    expect(recordedShots(events, 'browser_navigate')).toEqual([
      [{ id: shot.id, kind: 'after', mimeType: 'image/jpeg', ...VIEWPORT }],
    ]);
  });

  it('承認の依頼に要素の位置付きの操作の前の画面を出し、許可すると結果に前と後の 2 枚を載せる', async () => {
    const { events } = await runAgent([[navigate()], click('button "押す"')]);

    const before = firstApproval(events).preview;
    expect(before.action).toBe('browser-action');
    const shot =
      before.action === 'browser-action' ? before.screenshot : undefined;
    expect(shot).toMatchObject({ kind: 'before', mimeType: 'image/jpeg' });
    expect(shot && hasSignature(shot)).toBe(true);
    expect(boxInside(shot)).toBe(true);

    const [clicked] = resultsOf(events, 'browser_click');
    expect(clicked.isError).toBe(false);
    expect(clicked.screenshots?.map((s) => s.kind)).toEqual([
      'before',
      'after',
    ]);
    expect(clicked.screenshots?.[0].id).toBe(shot?.id);
    expect(clicked.screenshots?.every(hasSignature)).toBe(true);
    // 記録は ID と位置だけを持つ
    const [recorded] = recordedShots(events, 'browser_click');
    expect(recorded?.map((s) => s.id)).toEqual(
      clicked.screenshots?.map((s) => s.id)
    );
    expect(recorded?.every((s) => s.data === undefined)).toBe(true);
    expect(recorded?.[0].box).toEqual(shot?.box);
  });

  it('画面の外の要素は、見えるところまでスクロールしてから撮り、位置が画像に収まる', async () => {
    const { events } = await runAgent([
      [navigate()],
      click('button "下のボタン"'),
    ]);

    const preview = firstApproval(events).preview;
    expect(
      boxInside(
        preview.action === 'browser-action' ? preview.screenshot : undefined
      )
    ).toBe(true);
  });

  it('browser_screenshot は、モデルへ渡した PNG と同じ画像を結果に載せる', async () => {
    const { events, toolImages } = await runAgent(
      [[navigate()], [{ name: 'browser_screenshot', arguments: {} }]],
      { vision: true }
    );

    const [taken] = resultsOf(events, 'browser_screenshot');
    expect(taken.isError).toBe(false);
    const [shot] = taken.screenshots ?? [];
    expect(shot).toMatchObject({ kind: 'after', mimeType: 'image/png' });
    expect(hasSignature(shot)).toBe(true);
    expect(toolImages).toEqual([shot.data]);
  });
});

describe('準正常系', () => {
  it('拒否すると、結果には操作の前の画面だけを載せる', async () => {
    const { events } = await runAgent([[navigate()], click('button "押す"')], {
      approve: false,
    });

    const [rejected] = resultsOf(events, 'browser_click');
    expect(rejected.approval).toBe('rejected');
    expect(rejected.screenshots?.map((s) => s.kind)).toEqual(['before']);
  });

  it(`1 回の応答で ${MAX_TOOL_SCREENSHOTS_PER_MESSAGE} 枚を撮ったら、続きのツールは撮らずに結果だけを返す`, async () => {
    const { events } = await runAgent([
      Array.from({ length: MAX_TOOL_SCREENSHOTS_PER_MESSAGE + 1 }, () =>
        navigate()
      ),
    ]);

    const opened = resultsOf(events, 'browser_navigate');
    expect(opened).toHaveLength(MAX_TOOL_SCREENSHOTS_PER_MESSAGE + 1);
    expect(opened.every((result) => !result.isError)).toBe(true);
    expect(opened.filter((result) => result.screenshots).length).toBe(
      MAX_TOOL_SCREENSHOTS_PER_MESSAGE
    );
    expect(opened.at(-1)?.screenshots).toBeUndefined();
  }, 120_000);
});

describe('異常系', () => {
  it('承認の間に要素が変わって操作しなかったときも、前と後の画面を載せる（何が起きたかを見せる）', async () => {
    // ページは 2.5 秒後にボタンの名前を「消す」に変える。名前が変わってから許可する
    const { events } = await runAgent(
      [[navigate('/changing')], click('button "押す"')],
      { approveAfterMs: 3_000 }
    );

    const [refused] = resultsOf(events, 'browser_click');
    expect(refused.isError).toBe(true);
    // 名前が変わった要素には新しい参照が付くため、古い参照は引けず、操作せずに読み直しを促す
    expect(refused.result).toContain('browser_snapshot で読み直し');
    expect(refused.screenshots?.map((s) => s.kind)).toEqual([
      'before',
      'after',
    ]);
  });
});
