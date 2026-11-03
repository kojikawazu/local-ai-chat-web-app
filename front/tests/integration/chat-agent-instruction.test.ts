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
import type { AgentStreamEvent } from '@/lib/agent/tools/types';
import { MAX_INSTRUCTIONS_PER_RESPONSE } from '@/lib/shared/validation';
import { jsonRequest, routeContext } from './helpers/db';
import {
  ollamaChunksResponse,
  ollamaStreamResponse,
  stubFetch,
} from './helpers/ollama-stub';

/**
 * 応答の途中の指示（割り込み。#241。`docs/30-agent-interrupt.md`）の IT。
 *
 * `/api/chat` のストリームを少しずつ読み、`response_started` の応答の ID へ指示の API
 * （`/api/agent/responses/[id]/instructions`）で指示を送る。真の外部の Ollama・SearXNG は fetch スタブにし、
 * 「指示を送るまで返さない」応答で、ツールの実行中・本文の生成中・サブエージェントに任せている間を作る。DB は使わない。
 */
const CHAT_URL = 'http://localhost/api/chat';
const SEARXNG = 'http://localhost:8888/search';

let POST_CHAT: (request: NextRequest) => Promise<Response>;
let POST_INSTRUCTION: (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => Promise<Response>;

beforeAll(async () => {
  // 開発者のシェルの設定でツールが増えても結果が変わらないよう、ほかのツールの設定を空にする
  for (const name of [
    'LOCAL_FILE_ROOTS',
    'LOCAL_FILE_WRITE_ROOTS',
    'LOCAL_COMMANDS',
    'GITHUB_REPOS',
    'BROWSER_ENABLED',
    'KNOWLEDGE_VAULTS',
    'KNOWLEDGE_MEMORY_VAULT',
  ]) {
    vi.stubEnv(name, '');
  }
  ({ POST: POST_CHAT } = await import('@/app/api/chat/route'));
  ({ POST: POST_INSTRUCTION } =
    await import('@/app/api/agent/responses/[id]/instructions/route'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

/** Ollama の `/api/chat` に送られたボディのうち、確かめる項目 */
type ChatRequest = {
  messages: { role: string; content: string }[];
  tools?: unknown[];
};

/** 外から決着させる Promise（「指示を送るまで返さない」応答を作る） */
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => (open = resolve));
  return { promise, open };
}

/**
 * 止められるまで応答しない（実際の fetch と同じく、止められたら AbortError で失敗する）。
 *
 * @param signal - 呼び出し側の中断の信号
 * @returns 止められるまで決着しない Promise
 */
function hangUntilAborted(signal?: AbortSignal | null): Promise<Response> {
  return new Promise((_, reject) => {
    signal?.addEventListener('abort', () =>
      reject(new DOMException('This operation was aborted', 'AbortError'))
    );
  });
}

/** ツールの呼び出しを返す Ollama の応答 */
function toolCall(name: string, args: Record<string, unknown>): Response {
  return ollamaChunksResponse([
    { tool_calls: [{ function: { name, arguments: args } }] },
  ]);
}

/** 誰の問い合わせか（システムプロンプトで見分ける） */
type Caller = 'main' | 'researcher';

/**
 * Ollama・SearXNG をスタブにする。
 *
 * @param script - 誰の問い合わせに何を返すか（呼ばれた順）
 * @param search - SearXNG への応答
 * @returns 問い合わせの記録（呼ばれた順）
 */
function stub(
  script: Partial<
    Record<
      Caller,
      ((signal?: AbortSignal | null) => Response | Promise<Response>)[]
    >
  >,
  search: (signal?: AbortSignal | null) => Response | Promise<Response> = () =>
    Response.json({ results: [] })
) {
  const requests: { caller: Caller; body: ChatRequest }[] = [];
  stubFetch(async (url, init) => {
    if (url.startsWith(SEARXNG)) return search(init?.signal);
    // ボディは streamChat()（lib/llm/ollama.ts）が JSON.stringify したもので、形はアプリが決めている
    const body = JSON.parse(String(init?.body)) as ChatRequest;
    const caller: Caller = body.messages[0]?.content.includes(
      'リサーチャーです'
    )
      ? 'researcher'
      : 'main';
    requests.push({ caller, body });
    const next = script[caller]?.shift();
    if (!next) throw new Error(`予定外の問い合わせ（${caller}）`);
    return next(init?.signal);
  });
  return requests;
}

/**
 * エージェントモードで送り、ストリームを少しずつ読む。
 *
 * @param body - ボディに足す値
 * @param signal - 停止・切断の信号
 * @returns 届いたイベント・指定のイベントまで読む関数・最後まで読む関数
 */
async function open(body: Record<string, unknown> = {}, signal?: AbortSignal) {
  const res = await POST_CHAT(
    jsonRequest(
      CHAT_URL,
      'POST',
      { message: '調べて', enableTools: true, ...body },
      signal
    )
  );
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: AgentStreamEvent[] = [];
  let buffer = '';
  let ended = false;
  const until = async (
    match: (event: AgentStreamEvent) => boolean
  ): Promise<AgentStreamEvent> => {
    for (;;) {
      const found = events.find(match);
      if (found) return found;
      if (ended) throw new Error('目当てのイベントの前にストリームが閉じた');
      const { value, done } = await reader.read();
      if (done) {
        ended = true;
        continue;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) events.push(JSON.parse(line));
      }
    }
  };
  const started = await until((e) => e.type === 'response_started');
  const responseId =
    started.type === 'response_started' ? started.responseId : '';
  return {
    events,
    responseId,
    until,
    /** 最後まで読む */
    rest: async () => {
      await until(() => false).catch(() => {});
      return events;
    },
  };
}

/**
 * 指示の API へ送る。
 *
 * @param responseId - 応答の ID
 * @param content - 指示（文字列でなければそのまま送る）
 * @returns 応答
 */
function instruct(responseId: string, content: unknown) {
  return POST_INSTRUCTION(
    jsonRequest(
      `http://localhost/api/agent/responses/${responseId}/instructions`,
      'POST',
      { content }
    ),
    routeContext(responseId)
  );
}

describe('応答の途中の指示（割り込み）', () => {
  describe('正常系', () => {
    it('ツールの実行中に送った指示を、次の問い合わせの前に user の発言として読み、読んだことを知らせる', async () => {
      const searching = gate();
      const release = gate();
      const requests = stub(
        {
          main: [
            () => toolCall('web_search', { query: 'Ollama' }),
            () => ollamaStreamResponse(['日本語の出典で 3 行にまとめました']),
          ],
        },
        async () => {
          searching.open();
          await release.promise;
          return Response.json({ results: [] });
        }
      );

      const stream = await open();
      await searching.promise;
      const res = await instruct(
        stream.responseId,
        '日本語の出典だけで 3 行に'
      );
      expect(res.status).toBe(202);
      const { instructionId } = await res.json();
      release.open();
      const events = await stream.rest();

      const types = events.map((e) => e.type);
      expect(types.indexOf('instruction_applied')).toBeGreaterThan(
        types.indexOf('tool_call_result')
      );
      expect(types.indexOf('instruction_applied')).toBeLessThan(
        types.indexOf('text_delta')
      );
      expect(events.find((e) => e.type === 'instruction_applied')).toEqual({
        type: 'instruction_applied',
        instructionId,
        contentOffset: 0,
      });
      const last = requests.at(-1)!.body.messages.at(-1)!;
      expect(last.role).toBe('user');
      expect(last.content).toContain('追加の指示');
      expect(last.content).toContain('日本語の出典だけで 3 行に');
      expect(events.at(-1)).toMatchObject({ type: 'done' });
    });

    it('本文を書き終える前に届いた指示でも、書いた本文を残してもう 1 ラウンド回し、答え直させる', async () => {
      const writing = gate();
      const release = gate();
      const encoder = new TextEncoder();
      const line = (content: string, done = false) =>
        encoder.encode(
          JSON.stringify({
            model: 'test',
            message: { role: 'assistant', content },
            done,
          }) + '\n'
        );
      const requests = stub({
        main: [
          () =>
            new Response(
              new ReadableStream({
                async start(controller) {
                  // <think> の分割に備えて末尾を保留して流すため、長めの断片にする
                  controller.enqueue(
                    line('最初の長い答えをここに書いています。')
                  );
                  writing.open();
                  await release.promise;
                  controller.enqueue(line('', true));
                  controller.close();
                },
              })
            ),
          () => ollamaStreamResponse(['短く直した答え']),
        ],
      });

      const stream = await open();
      await writing.promise;
      await stream.until((e) => e.type === 'text_delta');
      expect((await instruct(stream.responseId, '短く')).status).toBe(202);
      release.open();
      const events = await stream.rest();

      expect(events.some((e) => e.type === 'instruction_applied')).toBe(true);
      expect(events.at(-1)).toMatchObject({
        type: 'done',
        metadata: { agentRounds: 2 },
      });
      const second = requests[1].body.messages;
      expect(second.at(-2)).toEqual({
        role: 'assistant',
        content: '最初の長い答えをここに書いています。',
      });
      expect(second.at(-1)?.content).toContain('短く');
    });

    it('サブエージェントに任せている間に届いたら、サブエージェントはここまででまとめて戻り、メインが指示を読む', async () => {
      const researching = gate();
      const requests = stub({
        main: [
          () =>
            toolCall('delegate_to_agent', {
              agent: 'researcher',
              task: '調べて',
            }),
          () => ollamaStreamResponse(['指示に沿った答え']),
        ],
        researcher: [
          (signal) => {
            researching.open();
            return hangUntilAborted(signal);
          },
          () => ollamaStreamResponse(['途中までの回答']),
        ],
      });

      const stream = await open({ enableSubAgents: true });
      await researching.promise;
      expect((await instruct(stream.responseId, '日本語だけ')).status).toBe(
        202
      );
      const events = await stream.rest();

      expect(
        events.find(
          (e) => e.type === 'tool_call_result' && e.name === 'delegate_to_agent'
        )
      ).toMatchObject({
        isError: false,
        result: '途中までの回答',
        summary: 'ツール 0 回（追加の指示でまとめた）',
      });
      // サブエージェントのまとめはツールを渡さない
      const final = requests.filter((r) => r.caller === 'researcher').at(-1)!;
      expect(final.body.tools).toBeUndefined();
      expect(requests.at(-1)!.body.messages.at(-1)?.content).toContain(
        '日本語だけ'
      );
    });
  });

  describe('準正常系', () => {
    it(`1 回の応答で ${MAX_INSTRUCTIONS_PER_RESPONSE} 件を超える指示は 409`, async () => {
      const searching = gate();
      const release = gate();
      stub(
        {
          main: [
            () => toolCall('web_search', { query: 'q' }),
            () => ollamaStreamResponse(['完了']),
          ],
        },
        async () => {
          searching.open();
          await release.promise;
          return Response.json({ results: [] });
        }
      );

      const stream = await open();
      await searching.promise;
      for (let i = 0; i < MAX_INSTRUCTIONS_PER_RESPONSE; i++) {
        expect((await instruct(stream.responseId, `指示 ${i}`)).status).toBe(
          202
        );
      }
      const over = await instruct(stream.responseId, 'もう 1 つ');
      expect(over.status).toBe(409);
      release.open();
      const events = await stream.rest();
      expect(
        events.filter((e) => e.type === 'instruction_applied')
      ).toHaveLength(MAX_INSTRUCTIONS_PER_RESPONSE);
    });

    it('指示が届かなければ、今までどおり答えて終わる', async () => {
      stub({ main: [() => ollamaStreamResponse(['答え'])] });

      const events = await (await open()).rest();

      expect(events.some((e) => e.type === 'instruction_applied')).toBe(false);
      expect(events.at(-1)).toMatchObject({
        type: 'done',
        metadata: { agentRounds: 1 },
      });
    });
  });

  describe('異常系', () => {
    it('終わった応答・知らない応答への指示は 404、ID・本文の不正は 400', async () => {
      stub({ main: [() => ollamaStreamResponse(['答え'])] });
      const stream = await open();
      await stream.rest();

      expect((await instruct(stream.responseId, '遅い指示')).status).toBe(404);
      expect((await instruct(crypto.randomUUID(), 'x')).status).toBe(404);
      expect((await instruct('not-a-uuid', 'x')).status).toBe(400);
      const empty = await instruct(crypto.randomUUID(), '   ');
      expect(empty.status).toBe(400);
      expect(await empty.json()).toEqual({ error: '指示を入力してください' });
    });

    it('停止したら受け箱を消し、その後の指示は 404', async () => {
      const searching = gate();
      stub(
        { main: [() => toolCall('web_search', { query: 'q' })] },
        (signal) => {
          searching.open();
          return hangUntilAborted(signal);
        }
      );
      const browser = new AbortController();
      const stream = await open({}, browser.signal);
      await searching.promise;

      browser.abort();
      await stream.rest();

      await vi.waitFor(async () =>
        expect((await instruct(stream.responseId, 'x')).status).toBe(404)
      );
    });
  });
});
