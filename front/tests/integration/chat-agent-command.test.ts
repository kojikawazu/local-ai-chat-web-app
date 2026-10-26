import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  vi,
} from 'vitest';
import { access, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import type { NextRequest } from 'next/server';
import type { AgentStreamEvent } from '@/lib/agent/tools/types';
import { resolveRoots } from '@/lib/agent/tools/local-files/config';
import { quoteArgv } from '@/lib/agent/tools/local-commands/parse';
import { jsonRequest, routeContext } from './helpers/db';
import { stubFetch, ollamaStreamResponse } from './helpers/ollama-stub';

/**
 * コマンドの実行の承認（#148 Phase B）の IT。
 *
 * `LOCAL_COMMANDS=node` と、作業フォルダにできる一時フォルダを設定して route を読み込み、Ollama だけを fetch スタブで差し替える。
 * `/api/chat` のストリームを少しずつ読み、`tool_approval_request` が届いたら承認の API を呼んで、
 * 許可で実行・拒否で実行しない・実行中の停止でプロセスを止める・実行の後は外部と通信するツールを止める、を確かめる。
 * プロセスの起動・停止そのものは local-command.test.ts が担う。この経路は DB を使わない。
 */
const CHAT_URL = 'http://localhost/api/chat';
const APPROVAL_URL = 'http://localhost/api/agent/approvals/x';

let base: string;
/** 作業フォルダ（実体のパス） */
let root: string;
let POST_CHAT: (request: NextRequest) => Promise<Response>;
let POST_APPROVAL: (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => Promise<Response>;
let GET_TOOLS: () => Promise<Response>;

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'command-approval-it-'));
  [root] = resolveRoots([base]);
  // registry.ts は環境変数を初めて使うときに読むため、設定してから route を読み込む
  vi.stubEnv('LOCAL_FILE_ROOTS', root);
  vi.stubEnv('LOCAL_FILE_WRITE_ROOTS', root);
  vi.stubEnv('LOCAL_COMMANDS', 'node');
  // テストを動かす node が PATH の先頭で見つかるようにする
  vi.stubEnv(
    'PATH',
    `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}`
  );
  ({ POST: POST_CHAT } = await import('@/app/api/chat/route'));
  ({ POST: POST_APPROVAL } =
    await import('@/app/api/agent/approvals/[id]/route'));
  ({ GET: GET_TOOLS } = await import('@/app/api/tools/route'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(base, { recursive: true, force: true });
});

/**
 * ツールの呼び出しだけを返す Ollama の応答（NDJSON 1 行）を作る。
 *
 * @param name - 呼ぶツール名
 * @param args - ツールへ渡す引数
 * @returns Ollama の応答
 */
function toolCallResponse(name: string, args: Record<string, unknown>) {
  const line = JSON.stringify({
    model: 'test',
    message: {
      role: 'assistant',
      content: '',
      tool_calls: [{ function: { name, arguments: args } }],
    },
    done: true,
  });
  return new Response(line + '\n', {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' },
  });
}

/**
 * 1 回目の問い合わせで run_command を呼び、2 回目に `then` のツールを呼び（指定時）、最後に「完了」と答える Ollama をスタブする。
 *
 * @param script - `node -e` に渡すスクリプト
 * @param then - run_command の後に呼ぶツール（外部と通信するツールが止まるかを確かめる）
 */
function stubCommandThenAnswer(
  script: string,
  then?: { name: string; args: Record<string, unknown> }
) {
  const responses = [
    () =>
      toolCallResponse('run_command', {
        command: quoteArgv(['node', '-e', script]),
        cwd: root,
      }),
    ...(then ? [() => toolCallResponse(then.name, then.args)] : []),
  ];
  let calls = 0;
  stubFetch(() =>
    (responses[calls++] ?? (() => ollamaStreamResponse(['完了'])))()
  );
}

/** 承認の依頼に対してテストがどうするか。`approve-then-cancel` は許可した直後にストリームを取り消す */
type Respond = 'approve' | 'reject' | 'approve-then-cancel';

/**
 * エージェント経路で送信し、ストリームを少しずつ読む。承認の依頼が届いたら `respond` のとおりにする。
 *
 * @param respond - 承認の依頼への答え方
 * @returns 受け取ったイベント（受信順）
 */
async function runAgent(respond: Respond) {
  const res = await POST_CHAT(
    jsonRequest(CHAT_URL, 'POST', { message: '実行して', enableTools: true })
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
        jsonRequest(APPROVAL_URL, 'POST', { approved: respond !== 'reject' }),
        routeContext(event.approvalId)
      );
      expect(decided.status).toBe(204);
      if (respond === 'approve-then-cancel') {
        await reader.cancel();
        return events;
      }
    }
  }
  return events;
}

/**
 * イベント列から、あるツールの実行結果を取り出す。
 *
 * @param events - イベント列
 * @param name - ツール名
 * @returns そのツールの tool_call_result
 */
function resultOf(events: AgentStreamEvent[], name: string) {
  return events.find(
    (event): event is Extract<AgentStreamEvent, { type: 'tool_call_result' }> =>
      event.type === 'tool_call_result' && event.name === name
  );
}

/**
 * ファイルがあるかを確かめる。
 *
 * @param file - ファイルのパス
 * @returns あれば true
 */
async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false
  );
}

/**
 * 実行されたらファイルを作る（`delayMs` 後）スクリプト。
 *
 * @param file - 作るファイル
 * @param delayMs - 作るまでの時間
 * @returns `node -e` に渡すスクリプト
 */
function writeMarker(file: string, delayMs = 0): string {
  return `setTimeout(() => { require('fs').writeFileSync(${JSON.stringify(file)}, 'x'); console.log('wrote'); }, ${delayMs})`;
}

describe('POST /api/chat（コマンドの実行の承認）', () => {
  describe('正常系', () => {
    it('承認の依頼にコマンドと作業フォルダを付けて送り、許可されたら実行して approved を残す', async () => {
      const marker = path.join(root, 'approved.txt');
      stubCommandThenAnswer(writeMarker(marker));

      const events = await runAgent('approve');

      expect(
        events.find((e) => e.type === 'tool_approval_request')
      ).toMatchObject({
        name: 'run_command',
        preview: { action: 'run', cwd: root },
      });
      expect(resultOf(events, 'run_command')).toMatchObject({
        isError: false,
        approval: 'approved',
        summary: '終了コード 0',
      });
      expect(resultOf(events, 'run_command')?.result).toContain('wrote');
      expect(events.at(-1)?.type).toBe('done');
      expect(await exists(marker)).toBe(true);
    });

    it('コマンドを実行した後は、その応答で外部と通信するツールを止める', async () => {
      stubCommandThenAnswer(`console.log('local output')`, {
        name: 'url_fetch',
        args: { url: 'https://example.com/' },
      });

      const events = await runAgent('approve');

      expect(resultOf(events, 'url_fetch')).toMatchObject({
        isError: true,
        summary: expect.stringContaining('実行しませんでした'),
      });
    });
  });

  describe('準正常系', () => {
    it('拒否されたら実行せずに rejected を残し、応答は最後まで続く', async () => {
      const marker = path.join(root, 'rejected.txt');
      stubCommandThenAnswer(writeMarker(marker));

      const events = await runAgent('reject');

      expect(resultOf(events, 'run_command')).toMatchObject({
        isError: true,
        approval: 'rejected',
        summary: '拒否されました',
      });
      expect(events.at(-1)?.type).toBe('done');
      expect(await exists(marker)).toBe(false);
    });
  });

  describe('異常系', () => {
    it('許可した後の実行中に停止・切断したら、プロセスを止める', async () => {
      const marker = path.join(root, 'cancelled.txt');
      stubCommandThenAnswer(writeMarker(marker, 1_500));

      await runAgent('approve-then-cancel');

      // 止まっていなければ 1.5 秒後にファイルを作る。それより後まで待って、作られていないことを確かめる
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      expect(await exists(marker)).toBe(false);
    });
  });
});

describe('GET /api/tools（LOCAL_COMMANDS あり）', () => {
  describe('正常系', () => {
    it('run_command が一覧に出る', async () => {
      const { tools } = await (await GET_TOOLS()).json();
      expect(tools.map((tool: { name: string }) => tool.name)).toContain(
        'run_command'
      );
    });
  });

  // 準正常系（LOCAL_COMMANDS・書き込みのフォルダが無ければ出ない）は chat-agent-approval.test.ts・tools.test.ts で確かめる。
  // 異常系: 引数を取らない GET で、入力起因の失敗経路が無い
});
