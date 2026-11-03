import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  vi,
} from 'vitest';
import type { NextRequest } from 'next/server';
import type { AgentStreamEvent } from '@/lib/agent/tools/types';
import type { importKnowledgeDocument as ImportKnowledgeDocument } from '@/lib/server/knowledge';
import { SUB_AGENT_FINAL_INSTRUCTION } from '@/lib/agent/sub-agent-loop';
import {
  MAX_DELEGATIONS_PER_RESPONSE,
  SUB_AGENT_MAX_ROUNDS,
} from '@/constants/agent/sub-agent';
import { jsonRequest, prisma, resetDb } from './helpers/db';
import type { StubDoneMetrics } from './helpers/ollama-stub';
import {
  ollamaChunksResponse,
  ollamaStreamResponse,
  stubFetch,
} from './helpers/ollama-stub';

/**
 * サブエージェントに任せる委譲のツール（`delegate_to_agent`。#26。`docs/29-multi-agent.md`）の IT。
 *
 * `/api/chat` を実 PostgreSQL（登録したドキュメント）で動かし、真の外部の Ollama（チャット・`/api/embed`）と
 * SearXNG を fetch スタブで差し替える。Ollama への問い合わせは、システムプロンプトでメインとサブエージェント
 * （リサーチャー・手元の読み手）を見分け、それぞれ決めた順に応答を返す。E2E では実際のモデルが委譲するかが
 * 非決定的なため、委譲の配線（渡すもの・返すもの・記録・止める規則・上限）はここで確かめる。
 * 時間の上限（まとめ始める時間・全体の時間）は、上限を短くして chat-agent-sub-agent-time.test.ts で確かめる。
 */
const URL = 'http://localhost/api/chat';
const SEARXNG = 'http://localhost:8888/search';

/** スタブの埋め込み（どの文にも同じベクトル。登録したドキュメントは必ず近いものとして当たる） */
const VECTOR = [1, 0, 0, 0];

/** 誰の問い合わせか（システムプロンプトで見分ける） */
type Caller = 'main' | 'researcher' | 'reader';

/** Ollama の `/api/chat` に送られたボディのうち、確かめる項目 */
type ChatRequest = {
  messages: { role: string; content: string }[];
  tools?: { function: { name: string } }[];
};

/** Ollama への問い合わせの記録（呼ばれた順） */
let requests: { caller: Caller; body: ChatRequest }[] = [];

let POST: (request: NextRequest) => Promise<Response>;
let GET_TOOLS: () => Promise<Response>;
let importKnowledgeDocument: typeof ImportKnowledgeDocument;

beforeAll(async () => {
  // 開発者のシェルの設定でツールが増えても結果が変わらないよう、ほかのツールの設定を空にする
  // （手元の読み手は、ファイル・GitHub が無くても search_documents で使える）
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
  ({ POST } = await import('@/app/api/chat/route'));
  ({ GET: GET_TOOLS } = await import('@/app/api/tools/route'));
  ({ importKnowledgeDocument } = await import('@/lib/server/knowledge'));
});

beforeEach(async () => {
  await resetDb();
  requests = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await resetDb();
  await prisma.$disconnect();
});

/**
 * 問い合わせのシステムプロンプトから、誰の問い合わせかを決める。
 *
 * @param body - Ollama へ送られたボディ
 * @returns メイン・リサーチャー・手元の読み手
 */
function callerOf(body: ChatRequest): Caller {
  const system =
    body.messages[0]?.role === 'system' ? body.messages[0].content : '';
  if (system.includes('リサーチャーです')) return 'researcher';
  if (system.includes('読み手です')) return 'reader';
  return 'main';
}

/** ツールの呼び出しを返す Ollama の応答を作る（同じラウンドで複数を呼べる） */
function toolCalls(
  calls: { name: string; arguments: Record<string, unknown> }[],
  metrics: StubDoneMetrics = {}
): Response {
  return ollamaChunksResponse(
    [{ tool_calls: calls.map((call) => ({ function: call })) }],
    metrics
  );
}

/** 委譲のツールの呼び出し */
function delegate(agent: string, task: string) {
  return { name: 'delegate_to_agent', arguments: { agent, task } };
}

/** 誰の問い合わせに、何を返すか（呼ばれた順に先頭から使う） */
type Script = Partial<
  Record<
    Caller,
    ((signal?: AbortSignal | null) => Response | Promise<Response>)[]
  >
>;

/**
 * Ollama・SearXNG をスタブにする。
 *
 * @param script - 誰の問い合わせに何を返すか。足りなくなったら例外（予定外の問い合わせ）
 * @returns スタブした fetch のモック関数
 */
function stubOllama(script: Script) {
  return stubFetch(async (url, init) => {
    if (url.endsWith('/api/embed')) {
      // ボディは embed()（lib/llm/ollama.ts）が JSON.stringify した { model, input } で、形はアプリが決めている
      const { input } = JSON.parse(String(init?.body)) as { input: string[] };
      return Response.json({ embeddings: input.map(() => VECTOR) });
    }
    if (url.startsWith(SEARXNG)) {
      return Response.json({
        results: [
          {
            title: '検索の結果のページ',
            url: 'https://example.com/page',
            content: '検索の結果の本文',
          },
        ],
      });
    }
    // ボディは streamChat()（lib/llm/ollama.ts）が JSON.stringify したもので、形はアプリが決めている
    const body = JSON.parse(String(init?.body)) as ChatRequest;
    const caller = callerOf(body);
    requests.push({ caller, body });
    const next = script[caller]?.shift();
    if (!next) throw new Error(`予定外の問い合わせ（${caller}）`);
    return next(init?.signal);
  });
}

/**
 * エージェントモードで送り、NDJSON を読み切ってイベント列にする。
 *
 * @param extra - ボディに足す値（既定はサブエージェントを有効にする）
 * @returns 受信したイベント（受信順）
 */
async function run(
  extra: Record<string, unknown> = { enableSubAgents: true }
): Promise<AgentStreamEvent[]> {
  const res = await POST(
    jsonRequest(URL, 'POST', {
      message: '調べて',
      enableTools: true,
      ...extra,
    })
  );
  expect(res.status).toBe(200);
  return (await res.text())
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as AgentStreamEvent);
}

/** 指定のツールの結果のイベント（呼ばれた順） */
function resultsOf(events: AgentStreamEvent[], name = 'delegate_to_agent') {
  return events.filter(
    (e): e is Extract<AgentStreamEvent, { type: 'tool_call_result' }> =>
      e.type === 'tool_call_result' && e.name === name
  );
}

/** 問い合わせに渡したツールの名前 */
function toolNamesOf(body: ChatRequest): string[] {
  return (body.tools ?? []).map((tool) => tool.function.name);
}

/** 登録したドキュメント（手元の読み手が search_documents で読む） */
async function addDocument() {
  const content = '# コーヒー\n\nブラックで飲む。砂糖もミルクも入れない。\n';
  await importKnowledgeDocument({
    name: 'coffee.md',
    kind: 'markdown',
    content,
    size: Buffer.byteLength(content),
  });
}

describe('POST /api/chat（サブエージェントに任せる）', () => {
  describe('正常系', () => {
    it('リサーチャーに任せると、任せた仕事だけで調べ、まとめた回答だけをメインへ返す', async () => {
      stubOllama({
        main: [
          () =>
            toolCalls([delegate('researcher', 'Next.js 16 の新機能を調べて')]),
          () => ollamaStreamResponse(['まとめました']),
        ],
        researcher: [
          () =>
            toolCalls([
              { name: 'web_search', arguments: { query: 'Next.js 16' } },
            ]),
          () =>
            ollamaStreamResponse([
              'Next.js 16 の要点（出典 https://example.com/page）',
            ]),
        ],
      });

      const events = await run();

      const [result] = resultsOf(events);
      expect(result).toMatchObject({
        result: 'Next.js 16 の要点（出典 https://example.com/page）',
        isError: false,
        summary: 'ツール 1 回',
        subAgent: {
          agent: 'researcher',
          task: 'Next.js 16 の新機能を調べて',
          rounds: 2,
          toolCalls: [
            {
              name: 'web_search',
              arguments: { query: 'Next.js 16' },
              isError: false,
              summary: '1 件',
            },
          ],
        },
      });
      // 保存する記録（done）にも委譲の記録が入る
      const done = events.at(-1);
      expect(done).toMatchObject({
        type: 'done',
        metadata: {
          toolCalls: [
            { name: 'delegate_to_agent', subAgent: { agent: 'researcher' } },
          ],
        },
      });

      expect(requests.map((r) => r.caller)).toEqual([
        'main',
        'researcher',
        'researcher',
        'main',
      ]);
      // サブエージェントは、自分のプロンプト（後ろに現在の日時）と任せた仕事だけで始める（メインの会話は渡さない）
      const [first] = requests.filter((r) => r.caller === 'researcher');
      expect(first.body.messages).toHaveLength(2);
      expect(first.body.messages[0].content).toContain('## 現在の日時');
      expect(first.body.messages[1]).toEqual({
        role: 'user',
        content: 'Next.js 16 の新機能を調べて',
      });
      // 中のツールの結果（検索の一覧）はメインへ渡さず、回答だけを渡す
      const last = requests.at(-1)!.body.messages;
      expect(last.at(-1)).toMatchObject({
        role: 'tool',
        content: 'Next.js 16 の要点（出典 https://example.com/page）',
      });
      expect(JSON.stringify(last)).not.toContain('検索の結果の本文');
    });

    it('メインには委譲のツールを渡し、サブエージェントには自分のツールだけを渡す（委譲・ドキュメントの検索を渡さない）', async () => {
      stubOllama({
        main: [
          () => toolCalls([delegate('researcher', '調べて')]),
          () => ollamaStreamResponse(['完了']),
        ],
        researcher: [() => ollamaStreamResponse(['回答'])],
      });

      await run();

      const main = toolNamesOf(requests[0].body);
      expect(main).toContain('delegate_to_agent');
      expect(main).not.toContain('search_documents');
      expect(toolNamesOf(requests[1].body)).toEqual([
        'web_search',
        'url_fetch',
        'get_current_datetime',
        'calculate',
      ]);
    });

    it('サブエージェントのトークン数も、応答の合計に足す', async () => {
      stubOllama({
        main: [
          () =>
            toolCalls([delegate('researcher', '調べて')], {
              eval_count: 10,
              eval_duration: 1_000_000,
            }),
          () =>
            ollamaStreamResponse(['完了'], {
              eval_count: 20,
              eval_duration: 1_000_000,
            }),
        ],
        researcher: [
          () =>
            ollamaStreamResponse(['回答'], {
              eval_count: 7,
              eval_duration: 1_000_000,
            }),
        ],
      });

      const events = await run();

      const done = events.at(-1);
      expect(done).toMatchObject({
        type: 'done',
        metadata: { metrics: { outputTokens: 37 } },
      });
      expect(resultsOf(events)[0].subAgent?.metrics).toMatchObject({
        outputTokens: 7,
      });
    });

    it('同じラウンドの 2 つの委譲は、1 つずつ順に実行する', async () => {
      stubOllama({
        main: [
          () =>
            toolCalls([
              delegate('researcher', '仕事 A'),
              delegate('researcher', '仕事 B'),
            ]),
          () => ollamaStreamResponse(['完了']),
        ],
        researcher: [
          () => toolCalls([{ name: 'web_search', arguments: { query: 'A' } }]),
          () => ollamaStreamResponse(['A の回答']),
          () => toolCalls([{ name: 'web_search', arguments: { query: 'B' } }]),
          () => ollamaStreamResponse(['B の回答']),
        ],
      });

      const events = await run();

      // 並べて実行すると、A の 2 回目より前に B の 1 回目が来る
      const tasks = requests
        .filter((r) => r.caller === 'researcher')
        .map((r) => r.body.messages[1].content);
      expect(tasks).toEqual(['仕事 A', '仕事 A', '仕事 B', '仕事 B']);
      expect(resultsOf(events).map((e) => e.result)).toEqual([
        'A の回答',
        'B の回答',
      ]);
    });

    it('委譲の中の手順の経過を、委譲の呼び出しの ID 付きで、開始と結果の間に送る（#26 Phase B）', async () => {
      stubOllama({
        main: [
          () => toolCalls([delegate('researcher', '調べて')]),
          () => ollamaStreamResponse(['完了']),
        ],
        researcher: [
          () => toolCalls([{ name: 'web_search', arguments: { query: 'q' } }]),
          () => ollamaStreamResponse(['回答']),
        ],
      });

      const events = await run();

      const progress = events.filter((e) =>
        [
          'tool_call_start',
          'sub_agent_step_start',
          'sub_agent_step_result',
          'tool_call_result',
        ].includes(e.type)
      );
      expect(progress.map((e) => e.type)).toEqual([
        'tool_call_start',
        'sub_agent_step_start',
        'sub_agent_step_result',
        'tool_call_result',
      ]);
      const [start, stepStart, stepResult, result] = progress;
      const callId = start.type === 'tool_call_start' ? start.callId : '';
      expect(stepStart).toMatchObject({
        callId,
        name: 'web_search',
        arguments: { query: 'q' },
      });
      expect(stepResult).toMatchObject({
        callId,
        name: 'web_search',
        isError: false,
        summary: '1 件',
        stepId:
          stepStart.type === 'sub_agent_step_start' ? stepStart.stepId : '',
      });
      expect(result).toMatchObject({ callId, name: 'delegate_to_agent' });
    });

    it('2 つの委譲の 2 つ目は順番待ちで始まり、1 つ目の結果の後に動き始めを送る（#26 Phase B）', async () => {
      stubOllama({
        main: [
          () =>
            toolCalls([
              delegate('researcher', '仕事 A'),
              delegate('researcher', '仕事 B'),
            ]),
          () => ollamaStreamResponse(['完了']),
        ],
        researcher: [
          () => ollamaStreamResponse(['A の回答']),
          () => ollamaStreamResponse(['B の回答']),
        ],
      });

      const events = await run();

      const starts = events.filter(
        (e): e is Extract<AgentStreamEvent, { type: 'tool_call_start' }> =>
          e.type === 'tool_call_start'
      );
      expect(starts.map((e) => e.queued)).toEqual([undefined, true]);
      const types = events
        .filter((e) => ['tool_call_begin', 'tool_call_result'].includes(e.type))
        .map((e) =>
          e.type === 'tool_call_begin' || e.type === 'tool_call_result'
            ? `${e.type}:${e.callId === starts[0].callId ? 'A' : 'B'}`
            : ''
        );
      expect(types).toEqual([
        'tool_call_result:A',
        'tool_call_begin:B',
        'tool_call_result:B',
      ]);
    });

    it('手元の読み手は、登録したドキュメントを search_documents で探して読む', async () => {
      stubOllama({
        main: [
          () => toolCalls([delegate('reader', 'コーヒーの好みを探して')]),
          () => ollamaStreamResponse(['ブラックです']),
        ],
        reader: [
          () =>
            toolCalls([
              {
                name: 'search_documents',
                arguments: { query: 'コーヒーの好み' },
              },
            ]),
          () => ollamaStreamResponse(['coffee.md に「ブラックで飲む」とある']),
        ],
      });
      await addDocument();

      const events = await run();

      const [result] = resultsOf(events);
      expect(result.isError).toBe(false);
      const [search] = result.subAgent!.toolCalls;
      expect(search).toMatchObject({
        name: 'search_documents',
        isError: false,
        summary: '1 件',
      });
      expect(search.result).toContain('coffee.md');
      expect(search.result).toContain('ブラックで飲む');
    });
  });

  describe('準正常系', () => {
    it('enableSubAgents が無ければ委譲のツールを渡さず、呼ばれても実行しない', async () => {
      stubOllama({
        main: [
          () => toolCalls([delegate('researcher', '調べて')]),
          () => ollamaStreamResponse(['完了']),
        ],
      });

      const events = await run({});

      expect(toolNamesOf(requests[0].body)).not.toContain('delegate_to_agent');
      expect(resultsOf(events)[0]).toMatchObject({
        isError: true,
        summary: 'delegate_to_agent はこの応答では使えません',
      });
      expect(requests.map((r) => r.caller)).toEqual(['main', 'main']);
    });

    it('並べて実行するツールには順番待ちを付けず、同じ名前でも呼び出しの ID で結果を分ける（#26 Phase B）', async () => {
      stubOllama({
        main: [
          () =>
            toolCalls([
              { name: 'web_search', arguments: { query: 'a' } },
              { name: 'web_search', arguments: { query: 'b' } },
            ]),
          () => ollamaStreamResponse(['完了']),
        ],
      });

      const events = await run();

      const starts = events.filter(
        (e): e is Extract<AgentStreamEvent, { type: 'tool_call_start' }> =>
          e.type === 'tool_call_start'
      );
      expect(starts.map((e) => e.queued)).toEqual([undefined, undefined]);
      expect(new Set(starts.map((e) => e.callId)).size).toBe(2);
      expect(
        resultsOf(events, 'web_search')
          .map((e) => e.callId)
          .sort()
      ).toEqual(starts.map((e) => e.callId).sort());
      expect(events.some((e) => e.type === 'tool_call_begin')).toBe(false);
    });

    it('メインは search_documents を呼べない（サブエージェントだけのツール）', async () => {
      stubOllama({
        main: [
          () =>
            toolCalls([
              { name: 'search_documents', arguments: { query: 'コーヒー' } },
            ]),
          () => ollamaStreamResponse(['完了']),
        ],
      });

      const events = await run();

      expect(resultsOf(events, 'search_documents')[0]).toMatchObject({
        isError: true,
        summary: 'search_documents はこの応答では使えません',
      });
    });

    it('サブエージェントが委譲のツールを呼んでも実行しない（1 段だけ）', async () => {
      stubOllama({
        main: [
          () => toolCalls([delegate('researcher', '調べて')]),
          () => ollamaStreamResponse(['完了']),
        ],
        researcher: [
          () => toolCalls([delegate('researcher', 'もっと調べて')]),
          () => ollamaStreamResponse(['回答']),
        ],
      });

      const events = await run();

      expect(resultsOf(events)[0].subAgent?.toolCalls).toEqual([
        expect.objectContaining({
          name: 'delegate_to_agent',
          isError: true,
          summary: 'delegate_to_agent はこの応答では使えません',
        }),
      ]);
      expect(requests.filter((r) => r.caller === 'researcher')).toHaveLength(2);
    });

    it('登録したドキュメントを渡した応答では、リサーチャーに任せない（手元の情報を外へ出さない）', async () => {
      stubOllama({
        main: [
          () => toolCalls([delegate('researcher', 'コーヒーについて調べて')]),
          () => ollamaStreamResponse(['完了']),
        ],
      });
      await addDocument();

      const events = await run({
        enableSubAgents: true,
        knowledgeEnabled: true,
      });

      expect(resultsOf(events)[0]).toMatchObject({ isError: true });
      expect(resultsOf(events)[0].result).toContain('実行しませんでした');
      expect(requests.some((r) => r.caller === 'researcher')).toBe(false);
    });

    it('手元の読み手に任せた後は、外部と通信するツールを止める', async () => {
      stubOllama({
        main: [
          () => toolCalls([delegate('reader', 'コーヒーの好みを探して')]),
          () =>
            toolCalls([
              { name: 'web_search', arguments: { query: 'コーヒー' } },
            ]),
          () => ollamaStreamResponse(['完了']),
        ],
        reader: [() => ollamaStreamResponse(['ブラック'])],
      });

      const events = await run();

      expect(resultsOf(events, 'web_search')[0]).toMatchObject({
        isError: true,
      });
      expect(resultsOf(events, 'web_search')[0].result).toContain(
        '実行しませんでした'
      );
    });

    it('サブエージェントのラウンドの上限に達したら、ツールを渡さずに最終回答を作らせる', async () => {
      const search = () =>
        toolCalls([{ name: 'web_search', arguments: { query: 'まだ' } }]);
      stubOllama({
        main: [
          () => toolCalls([delegate('researcher', '調べて')]),
          () => ollamaStreamResponse(['完了']),
        ],
        researcher: [
          ...Array.from({ length: SUB_AGENT_MAX_ROUNDS }, () => search),
          () => ollamaStreamResponse(['ここまでの回答']),
        ],
      });

      const events = await run();

      expect(resultsOf(events)[0]).toMatchObject({
        result: 'ここまでの回答',
        summary: `ツール ${SUB_AGENT_MAX_ROUNDS} 回（問い合わせの上限でまとめた）`,
        subAgent: { rounds: SUB_AGENT_MAX_ROUNDS + 1 },
      });
      const final = requests.filter((r) => r.caller === 'researcher').at(-1)!;
      expect(final.body.tools).toBeUndefined();
      expect(final.body.messages.at(-1)).toEqual({
        role: 'user',
        content: SUB_AGENT_FINAL_INSTRUCTION,
      });
    });

    it(`1 回の応答で ${MAX_DELEGATIONS_PER_RESPONSE} 回を超えて任せられない`, async () => {
      const count = MAX_DELEGATIONS_PER_RESPONSE + 1;
      stubOllama({
        main: [
          () =>
            toolCalls(
              Array.from({ length: count }, (_, i) =>
                delegate('researcher', `仕事 ${i + 1}`)
              )
            ),
          () => ollamaStreamResponse(['完了']),
        ],
        researcher: Array.from(
          { length: MAX_DELEGATIONS_PER_RESPONSE },
          () => () => ollamaStreamResponse(['回答'])
        ),
      });

      const events = await run();

      const results = resultsOf(events);
      expect(results.filter((e) => !e.isError)).toHaveLength(
        MAX_DELEGATIONS_PER_RESPONSE
      );
      expect(results.at(-1)).toMatchObject({ isError: true });
      expect(results.at(-1)!.summary).toContain(
        `${MAX_DELEGATIONS_PER_RESPONSE} 回まで`
      );
    });

    it('/api/tools は委譲のツールと使えるサブエージェントを返し、サブエージェントだけのツールを出さない', async () => {
      const body = await (await GET_TOOLS()).json();

      const names = body.tools.map((tool: { name: string }) => tool.name);
      expect(names).toContain('delegate_to_agent');
      expect(names).not.toContain('search_documents');
      expect(body.subAgents).toEqual([
        { name: 'researcher', label: 'Web の調べもの' },
        { name: 'reader', label: '手元の読みもの' },
      ]);
    });
  });

  describe('異常系', () => {
    it('サブエージェントの Ollama が失敗したら委譲の失敗として返し、メインは答え続ける', async () => {
      stubOllama({
        main: [
          () => toolCalls([delegate('researcher', '調べて')]),
          () => ollamaStreamResponse(['調べられませんでした']),
        ],
        researcher: [() => new Response('model not found', { status: 404 })],
      });

      const events = await run();

      const [result] = resultsOf(events);
      expect(result.isError).toBe(true);
      expect(result.summary).toContain(
        'サブエージェントが応答できませんでした'
      );
      expect(result.subAgent).toMatchObject({ agent: 'researcher', rounds: 1 });
      expect(events.at(-1)).toMatchObject({ type: 'done' });
      expect(events.some((e) => e.type === 'error')).toBe(false);
    });

    it('知らないサブエージェント・空の仕事は、サブエージェントを動かさずに失敗を返す', async () => {
      stubOllama({
        main: [
          () =>
            toolCalls([
              delegate('translator', '訳して'),
              delegate('researcher', '   '),
            ]),
          () => ollamaStreamResponse(['完了']),
        ],
      });

      const events = await run();

      expect(resultsOf(events).map((e) => e.summary)).toEqual([
        'agent は researcher・reader のどれかにしてください',
        'task に任せる仕事を書いてください',
      ]);
      expect(requests.some((r) => r.caller !== 'main')).toBe(false);
    });

    it('停止・切断すると、サブエージェントの問い合わせも止め、次のラウンドへ進まない', async () => {
      let researcherSignal: AbortSignal | null | undefined;
      let started!: () => void;
      const researcherStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      stubOllama({
        main: [() => toolCalls([delegate('researcher', '調べて')])],
        researcher: [
          (signal) => {
            researcherSignal = signal;
            started();
            // 中断されるまで応答しない（モデルの読み込み・生成の途中）
            return new Promise<Response>((_, reject) => {
              signal?.addEventListener('abort', () =>
                reject(new DOMException('aborted', 'AbortError'))
              );
            });
          },
        ],
      });
      const browser = new AbortController();

      const res = await POST(
        jsonRequest(
          URL,
          'POST',
          { message: '調べて', enableTools: true, enableSubAgents: true },
          browser.signal
        )
      );
      const reader = res.body!.getReader();
      await researcherStarted;
      browser.abort();

      // 中断後はイベントを送らずに閉じる
      let done = false;
      while (!done) ({ done } = await reader.read());
      expect(researcherSignal?.aborted).toBe(true);
      expect(requests.map((r) => r.caller)).toEqual(['main', 'researcher']);
    });
  });
});
