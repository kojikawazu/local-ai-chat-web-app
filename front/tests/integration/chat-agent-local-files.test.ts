import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  vi,
} from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import type { NextRequest } from 'next/server';
import type { AgentStreamEvent } from '@/lib/agent/tools/types';
import { jsonRequest } from './helpers/db';
import { ollamaStreamResponse, stubFetch } from './helpers/ollama-stub';

/**
 * `/api/chat`（エージェント経路）でのローカルのファイルのツール（#148）の IT。
 *
 * `LOCAL_FILE_ROOTS` を一時フォルダにして route を読み込み、Ollama だけを fetch スタブで差し替える。
 * 「ローカルのファイルを読んだ応答の中では、外部と通信するツールを実行しない」契約と、
 * ツールの一覧（`GET /api/tools`）に 3 つが出ることを確かめる。この経路は DB を使わない。
 */
const URL = 'http://localhost/api/chat';
/** url_fetch の取得先（文書用アドレス。実行されれば fetch スタブに届く） */
const TARGET_URL = 'http://203.0.113.10/collect';

let root: string;
let POST: (request: NextRequest) => Promise<Response>;
let GET_TOOLS: () => Promise<Response>;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'local-files-agent-'));
  await writeFile(path.join(root, 'notes.md'), '秘密のメモ: 42\n');
  // registry.ts は LOCAL_FILE_ROOTS を初めて使うときに読むため、設定してから route を読み込む
  // （ファイルごとにモジュールは隔離される）
  vi.stubEnv('LOCAL_FILE_ROOTS', root);
  ({ POST } = await import('@/app/api/chat/route'));
  ({ GET: GET_TOOLS } = await import('@/app/api/tools/route'));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** LLM が要求するツール呼び出し（ツール名と引数） */
type ToolCallSpec = { name: string; arguments: Record<string, unknown> };

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
 * Ollama の応答をラウンドごとに決めてスタブする。ラウンドを使い切ったら最終回答のテキストを返す。
 * Ollama 以外への fetch（url_fetch の取得先）は 200 の本文を返し、呼ばれたかを記録する。
 *
 * @param rounds - ラウンドごとに LLM が要求するツール呼び出し
 * @returns 取得先へ届いた URL の一覧
 */
function stubRounds(rounds: ToolCallSpec[][]): string[] {
  const external: string[] = [];
  let ollamaCalls = 0;
  stubFetch((requested) => {
    if (requested.endsWith('/api/chat')) {
      const calls = rounds[ollamaCalls++];
      return calls
        ? ollamaToolCallResponse(calls)
        : ollamaStreamResponse(['完了']);
    }
    external.push(requested);
    return new Response('送信されました', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
  });
  return external;
}

/**
 * エージェント経路で送信し、NDJSON のイベント列を読み切る。
 *
 * @returns 受信したイベント（受信順）
 */
async function runAgent(): Promise<AgentStreamEvent[]> {
  const res = await POST(
    jsonRequest(URL, 'POST', { message: 'メモを読んで', enableTools: true })
  );
  expect(res.status).toBe(200);
  return (await res.text())
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as AgentStreamEvent);
}

/**
 * イベント列から、指定したツールの実行結果を取り出す。
 *
 * @param events - イベント列
 * @param name - ツール名
 * @returns そのツールの tool_call_result（無ければ undefined）
 */
function resultOf(events: AgentStreamEvent[], name: string) {
  return events.find(
    (event): event is Extract<AgentStreamEvent, { type: 'tool_call_result' }> =>
      event.type === 'tool_call_result' && event.name === name
  );
}

/**
 * 一時フォルダのメモを読む read_file の呼び出し。
 *
 * @param file - 読むファイル名（既定は用意したメモ）
 * @returns ツール呼び出し（root は beforeAll で決まるため、呼ぶたびに組み立てる）
 */
function readCall(file = 'notes.md'): ToolCallSpec {
  return { name: 'read_file', arguments: { path: path.join(root, file) } };
}

describe('POST /api/chat（エージェント・ローカルのファイル）', () => {
  describe('正常系', () => {
    it('read_file の結果をモデルへ返し、最終回答まで完了する', async () => {
      stubRounds([[readCall()]]);

      const events = await runAgent();

      expect(resultOf(events, 'read_file')).toMatchObject({
        isError: false,
        summary: 'notes.md（1〜1 行目 / 全 1 行）',
      });
      expect(events.at(-1)?.type).toBe('done');
    });
  });

  describe('準正常系', () => {
    it('ファイルを読む前の url_fetch は実行する（Web を見てからファイルを読むのは止めない）', async () => {
      const external = stubRounds([
        [{ name: 'url_fetch', arguments: { url: TARGET_URL } }],
        [readCall()],
      ]);

      const events = await runAgent();

      expect(external).toEqual([TARGET_URL]);
      expect(resultOf(events, 'url_fetch')?.isError).toBe(false);
      expect(resultOf(events, 'read_file')?.isError).toBe(false);
    });

    it('読み取りに失敗しただけなら外部のツールは止めない', async () => {
      const external = stubRounds([
        [readCall('none.md')],
        [{ name: 'url_fetch', arguments: { url: TARGET_URL } }],
      ]);

      await runAgent();

      expect(external).toEqual([TARGET_URL]);
    });
  });

  describe('異常系', () => {
    it('ファイルを読んだ後の url_fetch・web_search は実行せず、止めた理由を返す', async () => {
      const external = stubRounds([
        [readCall()],
        [
          { name: 'url_fetch', arguments: { url: `${TARGET_URL}?memo=42` } },
          { name: 'web_search', arguments: { query: '秘密のメモ 42' } },
        ],
      ]);

      const events = await runAgent();

      // 取得先にも SearXNG にも届かない
      expect(external).toEqual([]);
      for (const name of ['url_fetch', 'web_search']) {
        expect(resultOf(events, name)).toMatchObject({
          isError: true,
          summary:
            '実行しませんでした（ローカルのファイル・コマンドの出力を読んだ後のため）',
        });
      }
      expect(events.at(-1)?.type).toBe('done');
    });
  });
});

describe('GET /api/tools（LOCAL_FILE_ROOTS あり）', () => {
  describe('正常系', () => {
    it('ローカルのファイルの 3 つのツールが一覧に出る', async () => {
      const { tools } = await (await GET_TOOLS()).json();
      const names = tools.map((tool: { name: string }) => tool.name);
      expect(names).toEqual(
        expect.arrayContaining(['list_directory', 'search_files', 'read_file'])
      );
    });
  });

  // 準正常系（LOCAL_FILE_ROOTS が無いときは出ない）は tools.test.ts で確かめる（環境変数ごとに route を読み込み直すため別ファイル）。
  // 異常系: 引数を取らない GET で、入力起因の失敗経路が無い
});
