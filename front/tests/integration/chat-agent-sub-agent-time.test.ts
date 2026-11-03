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
import type * as SubAgentConstants from '@/constants/agent/sub-agent';
import { SUB_AGENT_FINAL_INSTRUCTION } from '@/lib/agent/sub-agent-loop';
import { jsonRequest } from './helpers/db';
import {
  ollamaChunksResponse,
  ollamaStreamResponse,
  stubFetch,
} from './helpers/ollama-stub';

/**
 * サブエージェントの時間の上限（#26。`docs/29-multi-agent.md`「上限値」「実装で分かったこと」）の IT。
 *
 * まとめ始める時間（既定 180 秒）・全体の時間（既定 300 秒）を短くして、実際に止まることを確かめる。上限はモジュールの定数のため、
 * このファイルだけ `vi.mock` で差し替える（ほかの委譲の IT は chat-agent-sub-agent.test.ts）。
 * 真の外部の Ollama と SearXNG を fetch スタブにし、「止められるまで応答しない」応答で長い問い合わせ・取得を作る。DB は使わない。
 */

// まとめ始める時間・サブエージェント全体の時間（ミリ秒。テスト用に短くする）。
// vi.mock はファイルの先頭へ巻き上げられるため、使う値も vi.hoisted で先に作る
const { ANSWER_BY_MS, TIMEOUT_MS } = vi.hoisted(() => ({
  ANSWER_BY_MS: 200,
  TIMEOUT_MS: 600,
}));

vi.mock('@/constants/agent/sub-agent', async (importOriginal) => ({
  ...(await importOriginal<typeof SubAgentConstants>()),
  SUB_AGENT_ANSWER_BY_MS: ANSWER_BY_MS,
  SUB_AGENT_TIMEOUT_MS: TIMEOUT_MS,
}));

const URL = 'http://localhost/api/chat';
const SEARXNG = 'http://localhost:8888/search';

let POST: (request: NextRequest) => Promise<Response>;

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
  ({ POST } = await import('@/app/api/chat/route'));
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
  think?: boolean;
};

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

/** 委譲を 1 回だけ呼び、結果を受けたら答えるメインの応答 */
function mainScript() {
  let calls = 0;
  return () =>
    ++calls === 1
      ? ollamaChunksResponse([
          {
            tool_calls: [
              {
                function: {
                  name: 'delegate_to_agent',
                  arguments: { agent: 'researcher', task: '調べて' },
                },
              },
            ],
          },
        ])
      : ollamaStreamResponse(['完了']);
}

/**
 * Ollama・SearXNG をスタブにする。メインはシステムプロンプトで見分ける。
 *
 * @param researcher - リサーチャーの問い合わせへの応答（何回目か・ボディ・signal を受ける）
 * @param search - SearXNG への応答（省略時は空の結果）
 * @returns リサーチャーへの問い合わせのボディ（呼ばれた順）
 */
function stub(
  researcher: (
    call: number,
    body: ChatRequest,
    signal?: AbortSignal | null
  ) => Response | Promise<Response>,
  search: (signal?: AbortSignal | null) => Response | Promise<Response> = () =>
    Response.json({ results: [] })
) {
  const main = mainScript();
  const bodies: ChatRequest[] = [];
  stubFetch(async (url, init) => {
    if (url.startsWith(SEARXNG)) return search(init?.signal);
    // ボディは streamChat()（lib/llm/ollama.ts）が JSON.stringify したもので、形はアプリが決めている
    const body = JSON.parse(String(init?.body)) as ChatRequest;
    if (!body.messages[0]?.content.includes('リサーチャーです')) return main();
    bodies.push(body);
    return researcher(bodies.length, body, init?.signal);
  });
  return bodies;
}

/**
 * サブエージェントを有効にして送り、委譲のツールの結果を返す。
 *
 * @returns 委譲のツールの結果のイベントと、最後のイベント
 */
async function delegate() {
  const res = await POST(
    jsonRequest(URL, 'POST', {
      message: '調べて',
      enableTools: true,
      enableSubAgents: true,
    })
  );
  const events = (await res.text())
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as AgentStreamEvent);
  const result = events.find(
    (e): e is Extract<AgentStreamEvent, { type: 'tool_call_result' }> =>
      e.type === 'tool_call_result' && e.name === 'delegate_to_agent'
  );
  return { result: result!, last: events.at(-1) };
}

describe('サブエージェントの時間の上限', () => {
  describe('正常系', () => {
    it('まとめ始める時間を過ぎたら途中の問い合わせを止め、ツールを渡さず思考させずに最終回答を作らせる', async () => {
      const bodies = stub((call, _body, signal) =>
        call === 1
          ? hangUntilAborted(signal)
          : ollamaStreamResponse(['ここまでの回答'])
      );

      const { result, last } = await delegate();

      expect(result).toMatchObject({
        result: 'ここまでの回答',
        isError: false,
        summary: 'ツール 0 回（時間の上限でまとめた）',
        subAgent: { rounds: 2 },
      });
      const final = bodies.at(-1)!;
      expect(final.tools).toBeUndefined();
      expect(final.think).toBe(false);
      expect(final.messages.at(-1)).toEqual({
        role: 'user',
        content: SUB_AGENT_FINAL_INSTRUCTION,
      });
      expect(last).toMatchObject({ type: 'done' });
    });
  });

  describe('準正常系', () => {
    it('中のツールの取得の途中で時間を過ぎたら、ツールを止めて失敗として記録し、ここまでの情報でまとめる', async () => {
      const bodies = stub(
        (call) =>
          call === 1
            ? ollamaChunksResponse([
                {
                  tool_calls: [
                    {
                      function: {
                        name: 'web_search',
                        arguments: { query: 'q' },
                      },
                    },
                  ],
                },
              ])
            : ollamaStreamResponse(['調べた分の回答']),
        (signal) => hangUntilAborted(signal)
      );

      const { result } = await delegate();

      expect(result).toMatchObject({
        result: '調べた分の回答',
        isError: false,
        summary: 'ツール 1 回（時間の上限でまとめた）',
        subAgent: {
          toolCalls: [{ name: 'web_search', isError: true }],
        },
      });
      // ツールの結果（失敗）は履歴に入れてから最終回答を作らせる（呼び出しと結果の対応を崩さない）
      expect(bodies.at(-1)!.messages.map((m) => m.role)).toEqual([
        'system',
        'user',
        'assistant',
        'tool',
        'user',
      ]);
    });
  });

  describe('異常系', () => {
    it('最終回答も全体の時間までに終わらなければ、調べた分の記録と理由を返す（記録を失わない）', async () => {
      stub((call, _body, signal) =>
        call === 1
          ? ollamaChunksResponse([
              {
                tool_calls: [
                  {
                    function: {
                      name: 'web_search',
                      arguments: { query: 'q' },
                    },
                  },
                ],
              },
            ])
          : hangUntilAborted(signal)
      );

      const { result, last } = await delegate();

      expect(result).toMatchObject({
        isError: true,
        summary: `サブエージェントが応答できませんでした（まとめる前に時間の上限（${TIMEOUT_MS / 1000} 秒）に達しました）`,
        subAgent: {
          agent: 'researcher',
          toolCalls: [{ name: 'web_search', isError: false }],
        },
      });
      expect(last).toMatchObject({ type: 'done' });
    });
  });
});
