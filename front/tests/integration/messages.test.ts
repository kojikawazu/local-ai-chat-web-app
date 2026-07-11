import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { GET, POST } from '@/app/api/conversations/[id]/messages/route';
import { prisma, resetDb, jsonRequest, routeContext } from './helpers/db';

/**
 * `/api/conversations/[id]/messages`（取得・保存）の IT。
 * メッセージ永続化・並び順・バリデーション・会話存在チェック・updatedAt 更新を
 * 実 DB に対して検証する。
 */
const URL = 'http://localhost/api/conversations/x/messages';
const NONEXISTENT = '00000000-0000-0000-0000-000000000000';

/** テスト用の会話を1件作成して ID を返す。 */
async function createConversation(title = 'メッセージ用会話'): Promise<string> {
  const conv = await prisma.conversation.create({ data: { title } });
  return conv.id;
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /api/conversations/[id]/messages（保存）', () => {
  describe('正常系', () => {
    it('user メッセージを保存し 201 を返す。会話の updatedAt も更新される', async () => {
      const id = await createConversation();
      const before = await prisma.conversation.findUnique({ where: { id } });

      const res = await POST(
        jsonRequest(URL, 'POST', { role: 'user', content: 'こんにちは' }),
        routeContext(id),
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.role).toBe('user');
      expect(body.content).toBe('こんにちは');
      expect(body.conversationId).toBe(id);

      // DB に永続化 + 会話の updatedAt が進む（>= 元の値）
      const stored = await prisma.message.findUnique({ where: { id: body.id } });
      expect(stored?.content).toBe('こんにちは');
      const after = await prisma.conversation.findUnique({ where: { id } });
      expect(after!.updatedAt.getTime()).toBeGreaterThanOrEqual(before!.updatedAt.getTime());
    });

    it('metadata 付きメッセージを保存できる', async () => {
      const id = await createConversation();
      const res = await POST(
        jsonRequest(URL, 'POST', {
          role: 'assistant',
          content: '結果',
          metadata: { toolCalls: [{ name: 'calculate', result: '4' }] },
        }),
        routeContext(id),
      );
      expect(res.status).toBe(201);
      const stored = await prisma.message.findUnique({ where: { id: (await res.json()).id } });
      expect(stored?.metadata).toEqual({ toolCalls: [{ name: 'calculate', result: '4' }] });
    });
  });

  describe('準正常系', () => {
    it('assistant ロールも保存できる', async () => {
      const id = await createConversation();
      const res = await POST(
        jsonRequest(URL, 'POST', { role: 'assistant', content: '応答' }),
        routeContext(id),
      );
      expect(res.status).toBe(201);
    });
  });

  describe('異常系', () => {
    it('不正な JSON ボディは 400', async () => {
      const id = await createConversation();
      const res = await POST(jsonRequest(URL, 'POST', 'not-json'), routeContext(id));
      expect(res.status).toBe(400);
    });

    it('content 欠落は 400', async () => {
      const id = await createConversation();
      const res = await POST(jsonRequest(URL, 'POST', { role: 'user' }), routeContext(id));
      expect(res.status).toBe(400);
    });

    it('許可外ロール（system）は 400', async () => {
      const id = await createConversation();
      const res = await POST(
        jsonRequest(URL, 'POST', { role: 'system', content: 'x' }),
        routeContext(id),
      );
      expect(res.status).toBe(400);
    });

    it('存在しない会話への保存は 404', async () => {
      const res = await POST(
        jsonRequest(URL, 'POST', { role: 'user', content: 'x' }),
        routeContext(NONEXISTENT),
      );
      expect(res.status).toBe(404);
    });
  });
});

describe('GET /api/conversations/[id]/messages（取得）', () => {
  describe('正常系', () => {
    it('メッセージを作成日時の昇順で返す', async () => {
      const id = await createConversation();
      await prisma.message.create({ data: { conversationId: id, role: 'user', content: '1番目' } });
      await prisma.message.create({ data: { conversationId: id, role: 'assistant', content: '2番目' } });

      const res = await GET(jsonRequest(URL, 'GET'), routeContext(id));
      expect(res.status).toBe(200);
      const { messages } = await res.json();
      expect(messages.map((m: { content: string }) => m.content)).toEqual(['1番目', '2番目']);
    });
  });

  describe('準正常系', () => {
    it('メッセージが0件なら空配列を返す', async () => {
      const id = await createConversation();
      const res = await GET(jsonRequest(URL, 'GET'), routeContext(id));
      expect(res.status).toBe(200);
      expect((await res.json()).messages).toEqual([]);
    });
  });

  describe('異常系', () => {
    it('存在しない会話は 404', async () => {
      const res = await GET(jsonRequest(URL, 'GET'), routeContext(NONEXISTENT));
      expect(res.status).toBe(404);
    });
  });
});
