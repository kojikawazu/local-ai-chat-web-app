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
import { jsonRequest } from './helpers/db';
import {
  ollamaChunksResponse,
  ollamaStreamErrorResponse,
  ollamaStreamResponse,
  stubFetch,
} from './helpers/ollama-stub';

/**
 * Ollama がストリームの途中でエラーを返したときの `/api/chat` の IT。
 *
 * `qwen3.8:27b` の書いたツール呼び出しを Ollama が解釈できないと、HTTP 200 のまま `error` の行で終わる。
 * 実際のモデルでは決定的に起こせないため、再試行・失敗の伝え方はここで確かめる。DB は使わない。
 */
const URL = 'http://localhost/api/chat';
const STREAM_ERROR = 'XML syntax error on line 3: unexpected EOF';

/** 外部通信をしないローカルツール */
const TOOL_NAME = 'get_current_datetime';

/** Ollama の `/api/chat` に送られたボディのうち、確かめる項目 */
type ChatRequest = { messages: { role: string; content: string }[] };

/** 誰の問い合わせか（システムプロンプトで見分ける） */
type Caller = 'main' | 'researcher';

/** 問い合わせごとに順に返す応答 */
type Script = Partial<Record<Caller, (() => Response)[]>>;

/** Ollama への問い合わせの記録（呼ばれた順） */
let calls: Caller[] = [];

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
    'MCP_CONFIG_PATH',
  ]) {
    vi.stubEnv(name, '');
  }
  ({ POST } = await import('@/app/api/chat/route'));
  // 再試行の警告・失敗のログでテストの出力を埋めない
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  calls = [];
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/**
 * Ollama を決めた順の応答に差し替える。
 *
 * @param script - 問い合わせごとの応答
 */
function stubOllama(script: Script) {
  const next: Record<Caller, number> = { main: 0, researcher: 0 };
  stubFetch((url, init) => {
    if (!url.endsWith('/api/chat')) return new Response('{}', { status: 404 });
    const body = JSON.parse(String(init?.body)) as ChatRequest;
    const system =
      body.messages[0]?.role === 'system' ? body.messages[0].content : '';
    const caller: Caller = system.includes('リサーチャーです')
      ? 'researcher'
      : 'main';
    calls.push(caller);
    const respond = script[caller]?.[next[caller]++];
    if (!respond) throw new Error(`想定より多い問い合わせです: ${caller}`);
    return respond();
  });
}

/**
 * `/api/chat` を呼び、届いたイベントを読む。
 *
 * @param body - 足すボディ（省略時はエージェントモード）
 * @returns 届いたイベント
 */
async function run(
  body: Record<string, unknown> = { enableTools: true }
): Promise<AgentStreamEvent[]> {
  const res = await POST(
    jsonRequest(URL, 'POST', { message: '調べてください', ...body })
  );
  expect(res.status).toBe(200);
  return (await res.text())
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AgentStreamEvent);
}

/**
 * 届いた本文をつなぐ。
 *
 * @param events - 届いたイベント
 * @returns 本文
 */
function textOf(events: AgentStreamEvent[]): string {
  return events
    .flatMap((event) => (event.type === 'text_delta' ? [event.content] : []))
    .join('');
}

const failed = () => ollamaStreamErrorResponse(STREAM_ERROR);
const answer = (text: string) => () => ollamaStreamResponse([text]);
const toolCall =
  (name: string, args: Record<string, unknown> = {}) =>
  () =>
    ollamaChunksResponse([
      { tool_calls: [{ function: { name, arguments: args } }] },
    ]);

describe('POST /api/chat（Ollama のストリームの途中のエラー）', () => {
  describe('正常系', () => {
    it('本文が出る前のエラーはやり直し、次の応答を返す', async () => {
      stubOllama({ main: [failed, answer('回答です')] });

      const events = await run();

      expect(calls).toEqual(['main', 'main']);
      expect(textOf(events)).toBe('回答です');
      expect(events.some((event) => event.type === 'error')).toBe(false);
      expect(events.at(-1)?.type).toBe('done');
    });

    it('2 回失敗しても 3 回目で通れば応答を返す', async () => {
      stubOllama({ main: [failed, failed, answer('回答です')] });

      const events = await run();

      expect(calls).toHaveLength(3);
      expect(textOf(events)).toBe('回答です');
    });

    it('サブエージェントの問い合わせもやり直す', async () => {
      stubOllama({
        main: [
          toolCall('delegate_to_agent', {
            agent: 'researcher',
            task: '調べて',
          }),
          answer('まとめです'),
        ],
        researcher: [failed, answer('調べた結果です')],
      });

      const events = await run({ enableTools: true, enableSubAgents: true });

      expect(calls.filter((caller) => caller === 'researcher')).toHaveLength(2);
      const result = events.find((event) => event.type === 'tool_call_result');
      expect(result).toMatchObject({ result: '調べた結果です' });
      expect(textOf(events)).toBe('まとめです');
    });
  });

  describe('準正常系', () => {
    it('本文が出た後のエラーはやり直さず、届いた本文と失敗を残す', async () => {
      stubOllama({
        main: [
          () =>
            ollamaStreamErrorResponse(STREAM_ERROR, [
              { content: '途中までの本文ですここまで' },
            ]),
        ],
      });

      const events = await run();

      expect(calls).toHaveLength(1);
      expect(textOf(events)).toContain('途中までの本文です');
      expect(textOf(events)).toContain(STREAM_ERROR);
      expect(events.at(-1)?.type).toBe('done');
    });

    it('ツールの実行の後に失敗が続いても、error にせずツールの記録を残す', async () => {
      stubOllama({ main: [toolCall(TOOL_NAME), failed, failed, failed] });

      const events = await run();

      expect(events.some((event) => event.type === 'error')).toBe(false);
      expect(textOf(events)).toContain(STREAM_ERROR);
      expect(events.at(-1)).toMatchObject({
        type: 'done',
        metadata: { toolCalls: [{ name: TOOL_NAME }] },
      });
    });

    it('ツールの実行の後に本文なしで終わったら、本文で伝える', async () => {
      stubOllama({ main: [toolCall(TOOL_NAME), answer('')] });

      const events = await run();

      expect(textOf(events)).toContain('回答の本文が返りませんでした');
      expect(events.at(-1)?.type).toBe('done');
    });
  });

  describe('異常系', () => {
    it('やり直しても失敗が続けば error を返す', async () => {
      stubOllama({ main: [failed, failed, failed] });

      const events = await run();

      expect(calls).toHaveLength(3);
      const error = events.at(-1);
      expect(error?.type).toBe('error');
      expect(error).toMatchObject({
        message: expect.stringContaining(STREAM_ERROR),
      });
      expect(events.some((event) => event.type === 'done')).toBe(false);
    });

    it('サブエージェントの失敗が続けば、委譲の結果を失敗で返す', async () => {
      stubOllama({
        main: [
          toolCall('delegate_to_agent', {
            agent: 'researcher',
            task: '調べて',
          }),
          answer('調べられませんでした'),
        ],
        researcher: [failed, failed, failed],
      });

      const events = await run({ enableTools: true, enableSubAgents: true });

      expect(calls.filter((caller) => caller === 'researcher')).toHaveLength(3);
      const result = events.find((event) => event.type === 'tool_call_result');
      expect(result).toMatchObject({ isError: true });
      expect(textOf(events)).toBe('調べられませんでした');
    });

    it('通常のチャットでも error を返す', async () => {
      stubOllama({ main: [failed] });

      const events = await run({});

      expect(events.at(-1)?.type).toBe('error');
      expect(events.at(-1)).toMatchObject({
        message: expect.stringContaining(STREAM_ERROR),
      });
      expect(events.some((event) => event.type === 'done')).toBe(false);
    });
  });
});
