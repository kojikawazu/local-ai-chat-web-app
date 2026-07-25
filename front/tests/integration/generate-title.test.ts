import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from 'vitest';
import { POST } from '@/app/api/conversations/[id]/generate-title/route';
import { prisma, resetDb, jsonRequest, routeContext } from './helpers/db';
import { stubFetch } from './helpers/ollama-stub';
import { getDefaultModel } from '@/lib/ollama';
import { MAX_TITLE_LENGTH } from '@/lib/validation';

/**
 * `/api/conversations/[id]/generate-title` の IT。
 *
 * Ollama は真の外部なので fetch をスタブし、DB は実 PostgreSQL を使う。
 * 特に「**リクエストに載るモデル名が正準（`ollama.ts` の既定）と一致するか**」を
 * スタブへ渡ったボディで検証する。route が独自のデフォルト値を持つと、チャット本体と
 * タイトル生成で別モデルを呼んでしまうため（存在しないモデルなら 500 になる）。
 */
const URL = 'http://localhost/api/conversations/x/generate-title';
const NONEXISTENT = '00000000-0000-0000-0000-000000000000';
const NOT_UUID = 'not-a-uuid';

/** Ollama `/api/chat` の非ストリーミング成功レスポンスを組み立てる。 */
function ollamaChatResponse(content: string): Response {
  return new Response(
    JSON.stringify({ message: { role: 'assistant', content } }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }
  );
}

/** テスト用の会話を1件作成して ID を返す。 */
async function createConversation(title = '新しい会話'): Promise<string> {
  const conv = await prisma.conversation.create({ data: { title } });
  return conv.id;
}

/** スタブに渡った最初のリクエストボディを JSON として取り出す。 */
function sentBody(mock: ReturnType<typeof stubFetch>): Record<string, unknown> {
  return JSON.parse(String(mock.mock.calls[0][1]?.body));
}

beforeEach(async () => {
  await resetDb();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /api/conversations/[id]/generate-title', () => {
  describe('正常系', () => {
    it('生成タイトルで会話を更新し 200 を返す', async () => {
      const id = await createConversation();
      stubFetch(() => ollamaChatResponse('週末の予定'));

      const res = await POST(
        jsonRequest(URL, 'POST', { message: '週末どこに行こうか' }),
        routeContext(id)
      );
      expect(res.status).toBe(200);
      expect((await res.json()).title).toBe('週末の予定');

      // DB にも反映されている
      const stored = await prisma.conversation.findUnique({ where: { id } });
      expect(stored?.title).toBe('週末の予定');
    });

    it('model 未指定なら正準のデフォルトモデルで Ollama を呼ぶ', async () => {
      const id = await createConversation();
      const mock = stubFetch(() => ollamaChatResponse('タイトル'));

      await POST(
        jsonRequest(URL, 'POST', { message: 'やあ' }),
        routeContext(id)
      );

      // route が独自のデフォルト値を持たず ollama.ts の正準に委譲していることの検証
      expect(sentBody(mock).model).toBe(getDefaultModel());
      expect(sentBody(mock).stream).toBe(false);
    });

    it('model 指定時はその値で Ollama を呼ぶ', async () => {
      const id = await createConversation();
      const mock = stubFetch(() => ollamaChatResponse('タイトル'));

      await POST(
        jsonRequest(URL, 'POST', { message: 'やあ', model: 'gemma3:4b' }),
        routeContext(id)
      );

      expect(sentBody(mock).model).toBe('gemma3:4b');
    });
  });

  describe('準正常系', () => {
    it('生成タイトルが上限を超える場合は切り詰めて保存する', async () => {
      const id = await createConversation();
      stubFetch(() => ollamaChatResponse('あ'.repeat(MAX_TITLE_LENGTH + 50)));

      const res = await POST(
        jsonRequest(URL, 'POST', { message: 'やあ' }),
        routeContext(id)
      );
      expect(res.status).toBe(200);
      expect((await res.json()).title).toHaveLength(MAX_TITLE_LENGTH);
    });

    it('生成タイトルの前後空白はトリムされる', async () => {
      const id = await createConversation();
      stubFetch(() => ollamaChatResponse('  余白つき  '));

      const res = await POST(
        jsonRequest(URL, 'POST', { message: 'やあ' }),
        routeContext(id)
      );
      expect((await res.json()).title).toBe('余白つき');
    });

    it('長文メッセージは先頭500文字だけを LLM に渡す', async () => {
      const id = await createConversation();
      const mock = stubFetch(() => ollamaChatResponse('タイトル'));

      await POST(
        jsonRequest(URL, 'POST', { message: 'あ'.repeat(1000) }),
        routeContext(id)
      );

      const messages = sentBody(mock).messages as { content: string }[];
      // プロンプト定型文 + 先頭500文字。全文（1000文字）は渡らない
      expect(messages[0].content).toContain('あ'.repeat(500));
      expect(messages[0].content).not.toContain('あ'.repeat(501));
    });
  });

  describe('異常系', () => {
    it('UUID 形式でない ID は 400', async () => {
      const res = await POST(
        jsonRequest(URL, 'POST', { message: 'やあ' }),
        routeContext(NOT_UUID)
      );
      expect(res.status).toBe(400);
    });

    it('message が空なら 400（Ollama を呼ばない）', async () => {
      const id = await createConversation();
      const mock = stubFetch(() => ollamaChatResponse('タイトル'));

      const res = await POST(
        jsonRequest(URL, 'POST', { message: '   ' }),
        routeContext(id)
      );
      expect(res.status).toBe(400);
      expect(mock).not.toHaveBeenCalled();
    });

    it('Ollama が非 2xx を返すと 500', async () => {
      const id = await createConversation();
      stubFetch(() => new Response('model not found', { status: 404 }));

      const res = await POST(
        jsonRequest(URL, 'POST', { message: 'やあ' }),
        routeContext(id)
      );
      expect(res.status).toBe(500);
      // タイトルは更新されない
      const stored = await prisma.conversation.findUnique({ where: { id } });
      expect(stored?.title).toBe('新しい会話');
    });

    it('生成タイトルが空文字なら 500', async () => {
      const id = await createConversation();
      stubFetch(() => ollamaChatResponse('   '));

      const res = await POST(
        jsonRequest(URL, 'POST', { message: 'やあ' }),
        routeContext(id)
      );
      expect(res.status).toBe(500);
    });

    it('存在しない会話は DB 更新に失敗して 500', async () => {
      stubFetch(() => ollamaChatResponse('タイトル'));

      const res = await POST(
        jsonRequest(URL, 'POST', { message: 'やあ' }),
        routeContext(NONEXISTENT)
      );
      expect(res.status).toBe(500);
    });
  });
});
