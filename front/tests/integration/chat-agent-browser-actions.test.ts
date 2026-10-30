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
import type { BrowserActionApprovalPreview } from '@/types/agent/tool-call';
import {
  activeBrowserSessions,
  closeBrowser,
} from '@/lib/agent/tools/browser/browser';
import { BROWSER_NOT_OPENED_REASON } from '@/constants/agent/browser';
import { jsonRequest, routeContext } from './helpers/db';
import { ollamaStreamResponse, stubFetch } from './helpers/ollama-stub';

/**
 * `/api/chat`（エージェント経路）でのブラウザの操作のツール（#149 Phase C。`docs/18-browser-tools.md`「Phase C: 操作のツール」）の IT。
 *
 * 実際の Chromium で、テストの中で起こした HTTP サーバー（`BROWSER_LOCAL_ORIGINS`）のページを開き、承認の API で許可・拒否して操作する。
 * 操作したかは、ページのスクリプトがサーバーへ送るリクエスト（`/clicked`・`/deleted`）と、操作の後のスナップショットで確かめる。
 * Ollama（真の外部）だけを fetch スタブで差し替える。要素の参照は、前のツールの結果（スナップショット）から取って渡す。
 * 公開のページの操作（手元を読んだ後に断る）は、公開の Web に触れないと開けないため、ここでは確かめない。この経路は DB を使わない。
 */

/** LLM が要求するツール呼び出し（ツール名と引数） */
type ToolCallSpec = { name: string; arguments: Record<string, unknown> };

/** 1 ラウンドで LLM が要求するツール呼び出し。前のツールの結果（呼んだ順）から決めるときは関数にする */
type Round = ToolCallSpec[] | ((toolResults: string[]) => ToolCallSpec[]);

/** 承認の依頼への答え方。`abort` は答えずに送信を中断する */
type ApprovalAnswer = boolean | 'abort';

const CHAT_URL = 'http://localhost/api/chat';
const APPROVAL_URL = 'http://localhost/api/agent/approvals/x';

/** サーバーに届いた、ページのスクリプトからのリクエスト（操作したかの確認に使う） */
const hits: string[] = [];

let server: http.Server;
let origin: string;
let POST_CHAT: (request: NextRequest) => Promise<Response>;
let POST_APPROVAL: (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => Promise<Response>;
let GET_TOOLS: () => Promise<Response>;

/** 操作の確認用のページ。押す・入力する・選ぶ・confirm・新しいウィンドウを置く */
const ACTION_PAGE = `<!doctype html><html lang="ja"><head><title>操作の確認</title></head><body>
<h1 id="state">まだ押していません</h1>
<button onclick="fetch('/clicked'); document.getElementById('state').textContent = '押しました'">押す</button>
<button disabled>止めたボタン</button>
<form id="form">
  <label>名前 <input name="name"></label>
  <label>合言葉 <input type="password" name="secret"></label>
  <label>種別 <select name="kind" onchange="document.getElementById('kind').textContent = '選んだ: ' + this.value">
    <option value="q">質問</option><option value="r">要望</option><option disabled>停止中</option>
  </select></label>
  <button type="submit">送信する</button>
</form>
<p id="kind"></p><p id="sent"></p>
<button onclick="if (confirm('本当に消しますか？')) fetch('/deleted')">消す</button>
<a href="/other" target="_blank">別のウィンドウ</a>
<script>
document.getElementById('form').onsubmit = (event) => {
  event.preventDefault();
  document.getElementById('sent').textContent = '送信: ' + new FormData(event.target).get('name');
};
</script></body></html>`;

/** 承認を待つ間に、押すボタンの名前が「消す」に変わるページ（2.5 秒後） */
const CHANGING_PAGE = `<!doctype html><html lang="ja"><head><title>変わるページ</title></head><body>
<button onclick="fetch('/clicked')">押す</button>
<script>setTimeout(() => { document.querySelector('button').textContent = '消す'; }, 2500);</script>
</body></html>`;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const html = (body: string) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
    };
    switch (req.url) {
      case '/':
        return html(ACTION_PAGE);
      case '/changing':
        return html(CHANGING_PAGE);
      case '/other':
        return html('<title>別のページ</title><p>別のページ</p>');
      default:
        hits.push(req.url ?? '');
        res.end('ok');
    }
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
  ({ GET: GET_TOOLS } = await import('@/app/api/tools/route'));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await closeBrowser();
  server.closeAllConnections();
  server.close();
});

afterEach(() => {
  vi.unstubAllGlobals();
  hits.length = 0;
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
 * 承認の依頼が届いたら `answer` で答える。ラウンドを使い切ったら最終回答のテキストを返す。
 *
 * @param rounds - ラウンドごとに LLM が要求するツール呼び出し
 * @param answer - 承認の依頼への答え方（省略時は許可）
 * @returns 受信したイベント（受信順）
 */
async function runAgent(
  rounds: Round[],
  answer: (
    event: Extract<AgentStreamEvent, { type: 'tool_approval_request' }>
  ) => Promise<ApprovalAnswer> = async () => true
): Promise<AgentStreamEvent[]> {
  let ollamaCalls = 0;
  stubFetch((requested, init) => {
    if (requested.endsWith('/api/show')) {
      return Response.json({ capabilities: ['completion', 'tools'] });
    }
    const body = JSON.parse(String(init?.body)) as {
      messages: OllamaChatMessage[];
    };
    const toolResults = body.messages
      .filter((message) => message.role === 'tool')
      .map((message) => message.content);
    const round = rounds[ollamaCalls++];
    if (!round) return ollamaStreamResponse(['完了']);
    return ollamaToolCallResponse(
      typeof round === 'function' ? round(toolResults) : round
    );
  });

  const controller = new AbortController();
  const res = await POST_CHAT(
    jsonRequest(
      CHAT_URL,
      'POST',
      { message: 'ページを操作して', enableTools: true },
      controller.signal
    )
  );
  expect(res.status).toBe(200);
  const reader = res.body!.getReader(); // 200 の NDJSON 応答は必ず本文を持つ
  const decoder = new TextDecoder();
  const events: AgentStreamEvent[] = [];
  let buffer = '';
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch {
      break; // 中断した
    }
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines.filter((l) => l.trim())) {
      const event = JSON.parse(line) as AgentStreamEvent;
      events.push(event);
      if (event.type !== 'tool_approval_request') continue;
      const decision = await answer(event);
      if (decision === 'abort') {
        controller.abort();
        await reader.cancel().catch(() => {});
        return events;
      }
      const decided = await POST_APPROVAL(
        jsonRequest(APPROVAL_URL, 'POST', { approved: decision }),
        routeContext(event.approvalId)
      );
      expect(decided.status).toBe(204);
    }
  }
  return events;
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
 * スナップショットから、要素の参照を取る。
 *
 * @param snapshot - ツールの結果（スナップショットを含む）
 * @param element - 要素の行の頭（`button "押す"`）
 * @returns 参照（`e12` の形）
 */
function refOf(snapshot: string | undefined, element: string): string {
  const escaped = element.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ref = new RegExp(`${escaped}[^\\n]*?\\[ref=(\\w+)\\]`).exec(
    snapshot ?? ''
  )?.[1];
  if (!ref) throw new Error(`${element} の参照がありません:\n${snapshot}`);
  return ref;
}

/**
 * 最後のツールの結果から参照を取り、操作の呼び出しを作る。
 *
 * @param name - 操作のツール名
 * @param element - 操作する要素の行の頭
 * @param args - ref のほかの引数
 * @returns 前のツールの結果から呼び出しを決めるラウンド
 */
function act(
  name: string,
  element: string,
  args: Record<string, unknown> = {}
): (toolResults: string[]) => ToolCallSpec[] {
  return (toolResults) => [
    { name, arguments: { ref: refOf(toolResults.at(-1), element), ...args } },
  ];
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
 * イベント列から、承認の依頼を順に取り出す。
 *
 * @param events - イベント列
 * @returns tool_approval_request（受けた順）
 */
function approvalsOf(events: AgentStreamEvent[]) {
  return events.filter(
    (
      event
    ): event is Extract<AgentStreamEvent, { type: 'tool_approval_request' }> =>
      event.type === 'tool_approval_request'
  );
}

describe('正常系', () => {
  it('操作の 3 つのツールが登録される', async () => {
    const { tools } = await (await GET_TOOLS()).json();
    expect(tools.map((tool: { name: string }) => tool.name)).toEqual(
      expect.arrayContaining([
        'browser_click',
        'browser_type',
        'browser_select',
      ])
    );
  });

  it('開いたページの内容に要素の参照が付く', async () => {
    const events = await runAgent([[navigate()]]);
    const [opened] = resultsOf(events, 'browser_navigate');
    expect(opened.isError).toBe(false);
    expect(opened.result).toMatch(/button "押す" \[ref=e\d+\]/);
  });

  it('承認カードに実際の要素を出し、許可するとクリックして、操作の後のページを返す', async () => {
    const events = await runAgent([
      [navigate()],
      act('browser_click', 'button "押す"'),
    ]);

    const [approval] = approvalsOf(events);
    expect(approval.preview).toEqual<BrowserActionApprovalPreview>({
      action: 'browser-action',
      operation: 'click',
      url: `${origin}/`,
      title: '操作の確認',
      local: true,
      element: 'button "押す"',
      // 操作の前の画面（#200）の中身は chat-agent-browser-screenshots.test.ts で確かめる
      screenshot: expect.objectContaining({ kind: 'before' }),
    });
    const [clicked] = resultsOf(events, 'browser_click');
    expect(clicked).toMatchObject({
      isError: false,
      approval: 'approved',
      summary: 'クリック: button "押す"',
    });
    expect(clicked.result).toContain('押しました');
    expect(hits).toContain('/clicked');
    // 後始末はストリームを閉じた後に行うため、少し遅れて返る
    await vi.waitFor(() => expect(activeBrowserSessions()).toBe(0));
  });

  it('入力して submit で Enter を押すと、フォームを送る', async () => {
    const events = await runAgent([
      [navigate()],
      act('browser_type', 'textbox "名前"', { text: '田中', submit: true }),
    ]);
    expect(approvalsOf(events)[0].preview).toMatchObject({
      operation: 'type',
      element: 'textbox "名前"',
      value: '田中',
      submit: true,
    });
    const [typed] = resultsOf(events, 'browser_type');
    expect(typed).toMatchObject({
      isError: false,
      summary: '入力: textbox "名前"',
    });
    expect(typed.result).toContain('送信: 田中');
  });

  it('選択欄で、表示の文字で項目を選ぶ', async () => {
    const events = await runAgent([
      [navigate()],
      act('browser_select', 'combobox "種別"', { value: '要望' }),
    ]);
    const [selected] = resultsOf(events, 'browser_select');
    expect(selected).toMatchObject({
      isError: false,
      summary: '選択: combobox "種別" → 要望',
    });
    expect(selected.result).toContain('選んだ: r');
  });

  it('1 回の応答で並べた 2 つの操作は、1 つ目の結果が出てから 2 つ目の承認を求める', async () => {
    const events = await runAgent([
      [navigate()],
      (toolResults) => [
        {
          name: 'browser_type',
          arguments: {
            ref: refOf(toolResults.at(-1), 'textbox "名前"'),
            text: '佐藤',
          },
        },
        {
          name: 'browser_click',
          arguments: { ref: refOf(toolResults.at(-1), 'button "送信する"') },
        },
      ],
    ]);
    const kinds = events
      .filter(
        (event) =>
          event.type === 'tool_approval_request' ||
          (event.type === 'tool_call_result' &&
            event.name !== 'browser_navigate')
      )
      .map((event) =>
        event.type === 'tool_approval_request'
          ? `承認: ${event.name}`
          : `結果: ${event.type === 'tool_call_result' ? event.name : ''}`
      );
    expect(kinds).toEqual([
      '承認: browser_type',
      '結果: browser_type',
      '承認: browser_click',
      '結果: browser_click',
    ]);
    // 入力の後のページで送信を押したため、入れた名前が送られた
    expect(resultsOf(events, 'browser_click')[0].result).toContain(
      '送信: 佐藤'
    );
  });
});

describe('準正常系', () => {
  it('拒否したら操作しない', async () => {
    const events = await runAgent(
      [[navigate()], act('browser_click', 'button "押す"')],
      async () => false
    );
    expect(resultsOf(events, 'browser_click')[0]).toMatchObject({
      isError: true,
      approval: 'rejected',
    });
    expect(hits).not.toContain('/clicked');
  });

  it('承認を待つ間に要素が変わったら操作しない', async () => {
    const events = await runAgent(
      [[navigate('/changing')], act('browser_click', 'button "押す"')],
      // ページのスクリプトがボタンの名前を変える（2.5 秒後）まで待ってから許可する
      () => new Promise((resolve) => setTimeout(() => resolve(true), 3_500))
    );
    const [clicked] = resultsOf(events, 'browser_click');
    expect(clicked).toMatchObject({ isError: true, approval: 'approved' });
    expect(clicked.result).toContain('browser_snapshot で読み直し');
    expect(hits).not.toContain('/clicked');
  });

  it('見つからない参照は、承認を求めずに失敗する', async () => {
    const events = await runAgent([
      [navigate()],
      [{ name: 'browser_click', arguments: { ref: 'e999' } }],
    ]);
    expect(approvalsOf(events)).toHaveLength(0);
    expect(resultsOf(events, 'browser_click')[0].result).toContain(
      '参照 e999 の要素が見つかりません'
    );
  });

  it('パスワード欄には、承認を求めずに入力を断る', async () => {
    const events = await runAgent([
      [navigate()],
      act('browser_type', 'textbox "合言葉"', { text: 'secret' }),
    ]);
    expect(approvalsOf(events)).toHaveLength(0);
    expect(resultsOf(events, 'browser_type')[0]).toMatchObject({
      isError: true,
      summary: expect.stringContaining('パスワード欄'),
    });
  });

  it('ボタンには文字を入れられず、選択欄でない要素・選べない項目は選べない', async () => {
    const events = await runAgent([
      [navigate()],
      (toolResults) => {
        const snapshot = toolResults.at(-1);
        return [
          {
            name: 'browser_type',
            arguments: { ref: refOf(snapshot, 'button "押す"'), text: 'a' },
          },
          {
            name: 'browser_select',
            arguments: { ref: refOf(snapshot, 'button "押す"'), value: '要望' },
          },
          {
            name: 'browser_select',
            arguments: {
              ref: refOf(snapshot, 'combobox "種別"'),
              value: '停止中',
            },
          },
        ];
      },
    ]);
    expect(approvalsOf(events)).toHaveLength(0);
    expect(resultsOf(events, 'browser_type')[0].summary).toContain(
      '文字を入れられる要素ではありません'
    );
    const [notSelect, disabledOption] = resultsOf(events, 'browser_select');
    expect(notSelect.summary).toContain('選択欄（<select>）ではありません');
    expect(disabledOption.summary).toContain('選べる項目: 「質問」・「要望」');
  });

  it('confirm はキャンセルし、その文言を結果に書く', async () => {
    const events = await runAgent([
      [navigate()],
      act('browser_click', 'button "消す"'),
    ]);
    const [clicked] = resultsOf(events, 'browser_click');
    expect(clicked.isError).toBe(false);
    expect(clicked.result).toContain(
      'ダイアログ（confirm）「本当に消しますか？」をキャンセルしました'
    );
    expect(hits).not.toContain('/deleted');
  });

  it('新しいウィンドウは開かずに閉じ、開こうとした URL を結果に書く', async () => {
    const events = await runAgent([
      [navigate()],
      act('browser_click', 'link "別のウィンドウ"'),
    ]);
    const [clicked] = resultsOf(events, 'browser_click');
    expect(clicked.isError).toBe(false);
    expect(clicked.result).toContain(
      `新しいウィンドウ（${origin}/other）は開かずに閉じました`
    );
    // 元のページのまま
    expect(clicked.result).toContain(`URL: ${origin}/`);
  });

  it('まだページを開いていなければ、承認を求めずに失敗する', async () => {
    const events = await runAgent([
      [{ name: 'browser_click', arguments: { ref: 'e1' } }],
    ]);
    expect(approvalsOf(events)).toHaveLength(0);
    expect(resultsOf(events, 'browser_click')[0].summary).toBe(
      BROWSER_NOT_OPENED_REASON
    );
  });
});

describe('異常系', () => {
  it('無効のボタンは、許可しても上限の時間で操作をあきらめる', async () => {
    const events = await runAgent([
      [navigate()],
      act('browser_click', 'button "止めたボタン"'),
    ]);
    const [clicked] = resultsOf(events, 'browser_click');
    expect(clicked).toMatchObject({ isError: true, approval: 'approved' });
    expect(clicked.summary).toContain('操作できませんでした');
  });

  it('承認を待つ間に送信を止めたら、操作せずにセッションを閉じる', async () => {
    await runAgent(
      [[navigate()], act('browser_click', 'button "押す"')],
      async () => 'abort'
    );
    await vi.waitFor(() => expect(activeBrowserSessions()).toBe(0));
    expect(hits).not.toContain('/clicked');
  });
});
