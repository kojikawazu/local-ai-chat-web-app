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
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import type { NextRequest } from 'next/server';
import type { AgentStreamEvent } from '@/lib/agent/tools/types';
import { jsonRequest, routeContext } from './helpers/db';
import { ollamaStreamResponse, stubFetch } from './helpers/ollama-stub';

/**
 * ツールの実行前の承認（#148 Phase A2）の IT。
 *
 * `LOCAL_FILE_ROOTS`・`LOCAL_FILE_WRITE_ROOTS` を一時フォルダにして route を読み込み、Ollama だけを fetch スタブで差し替える。
 * `/api/chat` のストリームを少しずつ読み、`tool_approval_request` が届いたら承認の API（`/api/agent/approvals/[id]`）を
 * 呼んで、許可・拒否・停止での取り消しの契約を確かめる。待ち時間の上限（5 分）は UT（tool-approval.test.ts）で確かめる。
 * この経路は DB を使わない。
 */
const CHAT_URL = 'http://localhost/api/chat';
const APPROVAL_URL = 'http://localhost/api/agent/approvals/x';
const ORIGINAL = 'line 1\nline 2\n';

let root: string;
let file: string;
let POST_CHAT: (request: NextRequest) => Promise<Response>;
let POST_APPROVAL: (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => Promise<Response>;
let GET_TOOLS: () => Promise<Response>;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'approval-it-'));
  file = path.join(root, 'notes.md');
  // registry.ts は環境変数を初めて使うときに読むため、設定してから route を読み込む
  vi.stubEnv('LOCAL_FILE_ROOTS', root);
  vi.stubEnv('LOCAL_FILE_WRITE_ROOTS', root);
  ({ POST: POST_CHAT } = await import('@/app/api/chat/route'));
  ({ POST: POST_APPROVAL } =
    await import('@/app/api/agent/approvals/[id]/route'));
  ({ GET: GET_TOOLS } = await import('@/app/api/tools/route'));
});

beforeEach(async () => {
  await writeFile(file, ORIGINAL);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

/**
 * 1 回目の問い合わせで edit_file を呼び、2 回目以降は「完了」と答える Ollama をスタブする。
 *
 * @param args - edit_file の引数（path は一時フォルダのファイル）
 */
function stubEditThenAnswer(args: Record<string, unknown>) {
  let calls = 0;
  stubFetch(() => {
    if (calls++ > 0) return ollamaStreamResponse(['完了']);
    const line = JSON.stringify({
      model: 'test',
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: 'edit_file', arguments: args } }],
      },
      done: true,
    });
    return new Response(line + '\n', {
      status: 200,
      headers: { 'content-type': 'application/x-ndjson' },
    });
  });
}

/** 承認の依頼に対してテストがどうするか */
type Respond = 'approve' | 'reject' | 'cancel';

/**
 * エージェント経路で送信し、ストリームを少しずつ読む。承認の依頼が届いたら `respond` のとおりにする。
 *
 * `cancel` はストリームを取り消す（ブラウザの停止・切断と同じ）。取り消したら、そこまでのイベントを返す。
 *
 * @param respond - 承認の依頼への答え方
 * @returns 受け取ったイベント（受信順）と、承認の依頼の ID
 */
async function runAgent(respond: Respond) {
  const res = await POST_CHAT(
    jsonRequest(CHAT_URL, 'POST', { message: '直して', enableTools: true })
  );
  expect(res.status).toBe(200);
  const reader = res.body!.getReader(); // 200 の NDJSON 応答は必ず本文を持つ
  const decoder = new TextDecoder();
  const events: AgentStreamEvent[] = [];
  let approvalId: string | undefined;
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
      approvalId = event.approvalId;
      if (respond === 'cancel') {
        await reader.cancel();
        return { events, approvalId };
      }
      const decided = await POST_APPROVAL(
        jsonRequest(APPROVAL_URL, 'POST', { approved: respond === 'approve' }),
        routeContext(event.approvalId)
      );
      expect(decided.status).toBe(204);
    }
  }
  return { events, approvalId };
}

/**
 * イベント列から edit_file の実行結果を取り出す。
 *
 * @param events - イベント列
 * @returns edit_file の tool_call_result
 */
function editResult(events: AgentStreamEvent[]) {
  return events.find(
    (event): event is Extract<AgentStreamEvent, { type: 'tool_call_result' }> =>
      event.type === 'tool_call_result' && event.name === 'edit_file'
  );
}

describe('POST /api/chat（ツールの承認）', () => {
  describe('正常系', () => {
    it('承認の依頼に差分を付けて送り、許可されたら書いて approved を残す', async () => {
      stubEditThenAnswer({
        path: file,
        old_string: 'line 2',
        new_string: 'LINE 2',
      });

      const { events } = await runAgent('approve');

      const request = events.find((e) => e.type === 'tool_approval_request');
      expect(request).toMatchObject({
        name: 'edit_file',
        preview: { action: 'edit', added: 1, removed: 1 },
      });
      expect(editResult(events)).toMatchObject({
        isError: false,
        approval: 'approved',
        summary: 'notes.md を編集（+1 −1）',
      });
      const done = events.at(-1);
      expect(
        done?.type === 'done' && done.metadata?.toolCalls[0]
      ).toMatchObject({
        approval: 'approved',
      });
      expect(await readFile(file, 'utf8')).toBe('line 1\nLINE 2\n');
    });
  });

  describe('準正常系', () => {
    it('拒否されたら書かずに rejected を残し、応答は最後まで続く', async () => {
      stubEditThenAnswer({
        path: file,
        old_string: 'line 2',
        new_string: 'LINE 2',
      });

      const { events } = await runAgent('reject');

      expect(editResult(events)).toMatchObject({
        isError: true,
        approval: 'rejected',
        summary: '拒否されました',
      });
      expect(events.at(-1)?.type).toBe('done');
      expect(await readFile(file, 'utf8')).toBe(ORIGINAL);
    });

    it('準備で失敗したら承認を求めずに理由を返す', async () => {
      stubEditThenAnswer({
        path: file,
        old_string: '無い文字列',
        new_string: 'x',
      });

      const { events, approvalId } = await runAgent('approve');

      expect(approvalId).toBeUndefined();
      expect(editResult(events)).toMatchObject({ isError: true });
      expect(editResult(events)).not.toHaveProperty('approval');
    });
  });

  describe('異常系', () => {
    it('承認を待つ間に停止・切断したら書かず、その承認は決着済み（404）になる', async () => {
      stubEditThenAnswer({
        path: file,
        old_string: 'line 2',
        new_string: 'LINE 2',
      });

      const { approvalId } = await runAgent('cancel');
      expect(approvalId).toBeDefined();

      // 取り消しはストリームの cancel から伝わる。決着して登録が消えるまで待つ
      await expect
        .poll(async () => {
          const res = await POST_APPROVAL(
            jsonRequest(APPROVAL_URL, 'POST', { approved: true }),
            routeContext(approvalId ?? '')
          );
          return res.status;
        })
        .toBe(404);
      expect(await readFile(file, 'utf8')).toBe(ORIGINAL);
    });
  });
});

describe('POST /api/agent/approvals/[id]', () => {
  // 正常系（待っている承認に結果を渡すと 204）: 承認の依頼は /api/chat のストリームからしか作れないため、
  // 上の describe が runAgent の中で確かめる

  describe('準正常系', () => {
    it('待っている承認が無い ID は 404', async () => {
      const res = await POST_APPROVAL(
        jsonRequest(APPROVAL_URL, 'POST', { approved: true }),
        routeContext(crypto.randomUUID())
      );
      expect(res.status).toBe(404);
    });
  });

  describe('異常系', () => {
    it('UUID でない ID・approved が真偽値でないボディは 400', async () => {
      const badId = await POST_APPROVAL(
        jsonRequest(APPROVAL_URL, 'POST', { approved: true }),
        routeContext('not-a-uuid')
      );
      expect(badId.status).toBe(400);
      const badBody = await POST_APPROVAL(
        jsonRequest(APPROVAL_URL, 'POST', { approved: 'yes' }),
        routeContext(crypto.randomUUID())
      );
      expect(badBody.status).toBe(400);
      expect((await badBody.json()).error).toContain('approved');
    });
  });
});

describe('GET /api/tools（LOCAL_FILE_WRITE_ROOTS あり）', () => {
  describe('正常系', () => {
    it('書き込みのツールが一覧に出る', async () => {
      const { tools } = await (await GET_TOOLS()).json();
      expect(tools.map((tool: { name: string }) => tool.name)).toEqual(
        expect.arrayContaining(['write_file', 'edit_file'])
      );
    });
  });

  // 準正常系（書き込みのフォルダが無ければ出ない）は tools.test.ts で確かめる。
  // 異常系: 引数を取らない GET で、入力起因の失敗経路が無い
});
