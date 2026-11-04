import {
  describe,
  it,
  expect,
  beforeAll,
  afterEach,
  afterAll,
  vi,
} from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import type { NextRequest } from 'next/server';
import type { AgentStreamEvent } from '@/lib/agent/tools/types';
import type { McpStatus } from '@/types/agent/mcp';
import { closeMcpConnections } from '@/lib/agent/tools/mcp/connections';
import { jsonRequest, routeContext } from './helpers/db';
import { ollamaStreamResponse, stubFetch } from './helpers/ollama-stub';

/**
 * MCP のサーバーへの接続（#208）の IT。
 *
 * 実際の SDK と、テストの中で起動する本物の stdio のサーバー（`helpers/fake-mcp-server.mjs`）で、登録 → 実行 → 結果、承認、
 * 持ち出しの抑止、接続の失敗・切断を確かめる。Ollama だけを fetch スタブで差し替える。この経路は DB を使わない。
 */
const CHAT_URL = 'http://localhost/api/chat';
const APPROVAL_URL = 'http://localhost/api/agent/approvals/x';
const FAKE_SERVER = path.join(__dirname, 'helpers/fake-mcp-server.mjs');

let dir: string;
let notePath: string;
let POST_CHAT: (request: NextRequest) => Promise<Response>;
let POST_APPROVAL: (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => Promise<Response>;
let GET_TOOLS: () => Promise<Response>;

/** 結果のイベント */
type ResultEvent = Extract<AgentStreamEvent, { type: 'tool_call_result' }>;

/**
 * 確認用のサーバーの設定を作る。
 *
 * @param name - サーバーの名前
 * @param extra - 足す設定
 * @returns サーバーの設定
 */
function fakeServer(name: string, extra: Record<string, unknown> = {}) {
  return { command: process.execPath, args: [FAKE_SERVER, name], ...extra };
}

/**
 * 設定ファイルを書いて、接続を読み直す状態にする。
 *
 * @param mcpServers - 設定の `mcpServers`
 */
async function useConfig(mcpServers: Record<string, unknown>) {
  await closeMcpConnections();
  const file = path.join(dir, 'mcp.json');
  await writeFile(file, JSON.stringify({ mcpServers }));
  vi.stubEnv('MCP_CONFIG_PATH', file);
}

/**
 * 順にツールを呼び、終わったら「完了」と答える Ollama をスタブする（1 回の問い合わせで 1 つ呼ぶ）。
 *
 * @param calls - 呼ぶツールと引数
 */
function stubToolCalls(calls: [string, Record<string, unknown>][]) {
  let index = 0;
  stubFetch(() => {
    const call = calls[index++];
    if (!call) return ollamaStreamResponse(['完了']);
    const line = JSON.stringify({
      model: 'test',
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: call[0], arguments: call[1] } }],
      },
      done: true,
    });
    return new Response(line + '\n', {
      status: 200,
      headers: { 'content-type': 'application/x-ndjson' },
    });
  });
}

/**
 * エージェント経路で送信し、承認の依頼には `approved` のとおりに答えて、終わりまで読む。
 *
 * @param approved - 承認の依頼への答え
 * @returns 受け取ったイベント（受信順）
 */
async function runAgent(approved = true): Promise<AgentStreamEvent[]> {
  const res = await POST_CHAT(
    jsonRequest(CHAT_URL, 'POST', { message: '頼む', enableTools: true })
  );
  expect(res.status).toBe(200);
  const reader = res.body!.getReader(); // 200 の NDJSON 応答は必ず本文を持つ
  const decoder = new TextDecoder();
  const events: AgentStreamEvent[] = [];
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines.filter((l) => l.trim())) {
      const event = JSON.parse(line) as AgentStreamEvent;
      events.push(event);
      if (event.type !== 'tool_approval_request') continue;
      const decided = await POST_APPROVAL(
        jsonRequest(APPROVAL_URL, 'POST', { approved }),
        routeContext(event.approvalId)
      );
      expect(decided.status).toBe(204);
    }
  }
  return events;
}

/**
 * イベント列からツールの結果を取り出す。
 *
 * @param events - イベント列
 * @returns ツールの結果（受信順）
 */
function results(events: AgentStreamEvent[]): ResultEvent[] {
  return events.filter(
    (event): event is ResultEvent => event.type === 'tool_call_result'
  );
}

/**
 * `/api/tools` を読む。
 *
 * @returns ツールの名前と、MCP の接続の状態
 */
async function readTools(): Promise<{ names: string[]; mcp: McpStatus }> {
  const res = await GET_TOOLS();
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    tools: { name: string }[];
    mcp: McpStatus;
  };
  return { names: body.tools.map((tool) => tool.name), mcp: body.mcp };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'mcp-it-'));
  notePath = path.join(dir, 'note.md');
  await writeFile(notePath, '手元のメモ');
  // registry.ts は環境変数を初めて使うときに読むため、設定してから route を読み込む
  vi.stubEnv('LOCAL_FILE_ROOTS', dir);
  vi.stubEnv('LOCAL_FILE_WRITE_ROOTS', '');
  vi.stubEnv('LOCAL_COMMANDS', '');
  ({ POST: POST_CHAT } = await import('@/app/api/chat/route'));
  ({ POST: POST_APPROVAL } =
    await import('@/app/api/agent/approvals/[id]/route'));
  ({ GET: GET_TOOLS } = await import('@/app/api/tools/route'));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await closeMcpConnections();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

describe('MCP のツールの登録（GET /api/tools）', () => {
  describe('正常系', () => {
    it('サーバーのツールを mcp__ の名前で登録し、状態を返す', async () => {
      await useConfig({ notes: fakeServer('notes') });

      const { names, mcp } = await readTools();

      expect(names).toEqual(
        expect.arrayContaining([
          'mcp__notes__read_note',
          'mcp__notes__write_note',
        ])
      );
      expect(mcp.servers).toEqual([
        {
          name: 'notes',
          state: 'connected',
          toolCount: 6,
          omittedToolCount: 0,
        },
      ]);
    });

    it('設定の tools に書いたツールだけを登録する', async () => {
      await useConfig({ notes: fakeServer('notes', { tools: ['read_note'] }) });

      const { names, mcp } = await readTools();

      expect(names.filter((name) => name.startsWith('mcp__'))).toEqual([
        'mcp__notes__read_note',
      ]);
      expect(mcp.servers[0].toolCount).toBe(1);
    });

    it('応答をまたいで同じプロセスを使う', async () => {
      await useConfig({ notes: fakeServer('notes') });

      stubToolCalls([['mcp__notes__show_pid', {}]]);
      const first = results(await runAgent())[0].result;
      await readTools();
      stubToolCalls([['mcp__notes__show_pid', {}]]);
      const second = results(await runAgent())[0].result;

      expect(Number(first)).toBeGreaterThan(0);
      expect(second).toBe(first);
    });
  });

  describe('準正常系', () => {
    it('未設定なら何も登録しない', async () => {
      await closeMcpConnections();
      vi.stubEnv('MCP_CONFIG_PATH', '');

      const { names, mcp } = await readTools();

      expect(names.some((name) => name.startsWith('mcp__'))).toBe(false);
      expect(mcp).toEqual({ servers: [] });
    });

    it('設定の誤りのサーバーを外し、ほかのサーバーは使う', async () => {
      await useConfig({
        notes: fakeServer('notes'),
        broken: fakeServer('broken', { env: { TOKEN: '${NO_SUCH_VARIABLE}' } }),
      });

      const { mcp } = await readTools();

      expect(mcp.servers.map((server) => server.state)).toEqual([
        'connected',
        'invalid',
      ]);
      expect(mcp.servers[1].error).toContain('NO_SUCH_VARIABLE');
    });

    it('一覧が変わったと知らされたら、次の応答で取り直す', async () => {
      await useConfig({ notes: fakeServer('notes') });
      stubToolCalls([['mcp__notes__add_tool', {}]]);

      await runAgent();
      const { names } = await readTools();

      expect(names).toContain('mcp__notes__added_tool');
    });
  });

  describe('異常系', () => {
    it('起動できないサーバーは失敗にして理由を返す', async () => {
      await useConfig({ gone: { command: '/no/such/program' } });

      const { mcp } = await readTools();

      expect(mcp.servers[0]).toMatchObject({ name: 'gone', state: 'failed' });
      expect(mcp.servers[0].error).toContain('ENOENT');
    });

    it('失敗の直後は、読み直しても起動し直さない', async () => {
      const log = path.join(dir, 'starts.log');
      await writeFile(log, '');
      await useConfig({
        flaky: {
          command: process.execPath,
          args: [
            '-e',
            `require('fs').appendFileSync(${JSON.stringify(log)}, 'x'); process.exit(1)`,
          ],
        },
      });

      await readTools();
      await readTools();

      expect(await readFile(log, 'utf8')).toBe('x');
    });

    it('設定ファイルが無ければ全体の誤りにする', async () => {
      await closeMcpConnections();
      vi.stubEnv('MCP_CONFIG_PATH', path.join(dir, 'missing.json'));

      const { mcp } = await readTools();

      expect(mcp.configError).toContain('読めません');
      expect(mcp.servers).toEqual([]);
    });

    it('JSON でない設定ファイルは全体の誤りにする', async () => {
      await closeMcpConnections();
      const file = path.join(dir, 'broken.json');
      await writeFile(file, '{');
      vi.stubEnv('MCP_CONFIG_PATH', file);

      expect((await readTools()).mcp.configError).toContain('読めません');
    });
  });
});

describe('MCP のツールの実行（POST /api/chat）', () => {
  describe('正常系', () => {
    it('読むツールは承認なしで実行し、入れ子の引数を渡す', async () => {
      await useConfig({ notes: fakeServer('notes') });
      stubToolCalls([
        ['mcp__notes__read_note', { id: '1', options: { limit: 3 } }],
      ]);

      const events = await runAgent();

      expect(events.some((e) => e.type === 'tool_approval_request')).toBe(
        false
      );
      expect(results(events)[0]).toMatchObject({
        name: 'mcp__notes__read_note',
        isError: false,
        result: 'notes のメモ 1: 合言葉はオーロラ',
      });
    });

    it('注釈の無いツールは承認カードに引数を出し、許可の後に実行する', async () => {
      await useConfig({ notes: fakeServer('notes') });
      stubToolCalls([['mcp__notes__write_note', { body: 'こんにちは' }]]);

      const events = await runAgent();

      expect(
        events.find((e) => e.type === 'tool_approval_request')
      ).toMatchObject({
        preview: {
          action: 'mcp-call',
          server: 'notes',
          tool: 'write_note',
          arguments: JSON.stringify({ body: 'こんにちは' }, null, 2),
          readSources: [],
        },
      });
      expect(results(events)[0]).toMatchObject({
        isError: false,
        approval: 'approved',
        result: 'notes に書きました: こんにちは',
      });
    });

    it('同じサーバーは読んだ後も続けて読める', async () => {
      await useConfig({ notes: fakeServer('notes') });
      stubToolCalls([
        ['mcp__notes__read_note', { id: '1' }],
        ['mcp__notes__read_note', { id: '2' }],
      ]);

      const events = await runAgent();

      expect(results(events).map((r) => r.isError)).toEqual([false, false]);
    });

    it('別のサーバーへの書き込みは、読んだものを承認カードに出して通す', async () => {
      await useConfig({ a: fakeServer('a'), b: fakeServer('b') });
      stubToolCalls([
        ['mcp__a__read_note', { id: '1' }],
        ['mcp__b__write_note', { body: '要約' }],
      ]);

      const events = await runAgent();

      expect(
        events.find((e) => e.type === 'tool_approval_request')
      ).toMatchObject({ preview: { server: 'b', readSources: ['a'] } });
      expect(results(events)[1]).toMatchObject({
        isError: false,
        approval: 'approved',
      });
    });

    it('サーバーへはアプリの環境変数を渡さず、設定の env だけを足す', async () => {
      vi.stubEnv('MCP_IT_SECRET', 'secret');
      await useConfig({
        notes: fakeServer('notes', { env: { GIVEN: '${MCP_IT_SECRET}' } }),
      });
      stubToolCalls([['mcp__notes__show_env', {}]]);

      const events = await runAgent();

      const names = results(events)[0].result.split(',');
      expect(names).toContain('GIVEN');
      expect(names).not.toContain('MCP_IT_SECRET');
      expect(names).not.toContain('DATABASE_URL');
    });
  });

  describe('準正常系', () => {
    it('拒否されたら実行しない', async () => {
      await useConfig({ notes: fakeServer('notes') });
      stubToolCalls([['mcp__notes__write_note', { body: 'x' }]]);

      const events = await runAgent(false);

      expect(results(events)[0]).toMatchObject({
        isError: true,
        approval: 'rejected',
      });
    });

    it('alwaysApprove の読むツールは承認を求める', async () => {
      await useConfig({
        notes: fakeServer('notes', { alwaysApprove: ['read_note'] }),
      });
      stubToolCalls([['mcp__notes__read_note', { id: '1' }]]);

      const events = await runAgent();

      expect(events.some((e) => e.type === 'tool_approval_request')).toBe(true);
    });

    it('読んだ後の、別のサーバーの読むツールを止める', async () => {
      await useConfig({ a: fakeServer('a'), b: fakeServer('b') });
      stubToolCalls([
        ['mcp__a__read_note', { id: '1' }],
        ['mcp__b__read_note', { id: '2' }],
      ]);

      const events = await runAgent();

      expect(results(events)[1]).toMatchObject({ isError: true });
      expect(results(events)[1].result).toContain('実行しませんでした');
    });

    it('読んだ後の web_search を止める', async () => {
      await useConfig({ notes: fakeServer('notes') });
      stubToolCalls([
        ['mcp__notes__read_note', { id: '1' }],
        ['web_search', { query: '読んだ内容' }],
      ]);

      const events = await runAgent();

      expect(results(events)[1].result).toContain('実行しませんでした');
    });

    it('手元のファイルを読んだ後の、読むツールを止める', async () => {
      await useConfig({ notes: fakeServer('notes') });
      stubToolCalls([
        ['read_file', { path: notePath }],
        ['mcp__notes__read_note', { id: '1' }],
      ]);

      const events = await runAgent();

      expect(results(events)[0].isError).toBe(false);
      expect(results(events)[1].result).toContain('実行しませんでした');
    });

    it('手元のファイルを読んだ後の書き込みは、手元の情報を読んだと承認カードに出す', async () => {
      await useConfig({ notes: fakeServer('notes') });
      stubToolCalls([
        ['read_file', { path: notePath }],
        ['mcp__notes__write_note', { body: '要約' }],
      ]);

      const events = await runAgent();

      expect(
        events.find((e) => e.type === 'tool_approval_request')
      ).toMatchObject({ preview: { readSources: ['手元の情報'] } });
    });

    it('引数の間違いは失敗の結果でモデルへ返す', async () => {
      await useConfig({ notes: fakeServer('notes') });
      stubToolCalls([['mcp__notes__read_note', { id: 1 }]]);

      const events = await runAgent();

      expect(results(events)[0].isError).toBe(true);
      expect(events.at(-1)?.type).toBe('done');
    });
  });

  describe('異常系', () => {
    it('起動できないサーバーがあっても応答は続く', async () => {
      await useConfig({ gone: { command: '/no/such/program' } });
      stubToolCalls([]);

      const events = await runAgent();

      expect(events.at(-1)?.type).toBe('done');
      expect(events).toContainEqual({ type: 'text_delta', content: '完了' });
    });

    it('実行中にサーバーが落ちたら失敗にし、次の応答で接続し直す', async () => {
      await useConfig({ notes: fakeServer('notes') });
      stubToolCalls([['mcp__notes__crash', {}]]);

      const crashed = await runAgent();
      expect(results(crashed)[0].isError).toBe(true);
      expect(crashed.at(-1)?.type).toBe('done');

      stubToolCalls([['mcp__notes__read_note', { id: '1' }]]);
      const next = await runAgent();
      expect(results(next)[0]).toMatchObject({ isError: false });
    });

    it('渡していないツールを呼ばれても実行しない', async () => {
      await useConfig({ notes: fakeServer('notes', { tools: ['read_note'] }) });
      stubToolCalls([['mcp__notes__show_env', {}]]);

      const events = await runAgent();

      expect(results(events)[0].isError).toBe(true);
    });
  });
});
