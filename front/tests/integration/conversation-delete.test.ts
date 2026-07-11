import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { DELETE } from '@/app/api/conversations/[id]/route';
import { prisma, resetDb, jsonRequest, routeContext } from './helpers/db';

/**
 * `DELETE /api/conversations/[id]` の IT。
 * カスケード削除（Conversation→Message）・UUID バリデーション・存在しない ID の
 * エラー挙動を実 DB に対して検証する。
 */
const URL = 'http://localhost/api/conversations/x';

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('DELETE /api/conversations/[id]', () => {
  describe('正常系', () => {
    it('会話を削除し、紐づくメッセージも Cascade で連鎖削除される', async () => {
      const conv = await prisma.conversation.create({ data: { title: '削除対象' } });
      await prisma.message.create({
        data: { conversationId: conv.id, role: 'user', content: 'hello' },
      });

      const res = await DELETE(jsonRequest(URL, 'DELETE'), routeContext(conv.id));
      expect(res.status).toBe(200);
      expect((await res.json()).success).toBe(true);

      // 会話・メッセージともに DB から消えている（onDelete: Cascade）
      expect(await prisma.conversation.findUnique({ where: { id: conv.id } })).toBeNull();
      expect(await prisma.message.count({ where: { conversationId: conv.id } })).toBe(0);
    });
  });

  describe('準正常系', () => {
    it('メッセージが無い会話も削除できる', async () => {
      const conv = await prisma.conversation.create({ data: { title: '空の会話' } });
      const res = await DELETE(jsonRequest(URL, 'DELETE'), routeContext(conv.id));
      expect(res.status).toBe(200);
      expect(await prisma.conversation.findUnique({ where: { id: conv.id } })).toBeNull();
    });
  });

  describe('異常系', () => {
    it('UUID 形式でない ID は 400 を返す（DB へ到達しない）', async () => {
      const res = await DELETE(jsonRequest(URL, 'DELETE'), routeContext('not-a-uuid'));
      expect(res.status).toBe(400);
    });

    it('存在しない（が UUID 形式の）ID の削除は 500 を返す', async () => {
      const res = await DELETE(
        jsonRequest(URL, 'DELETE'),
        routeContext('00000000-0000-0000-0000-000000000000'),
      );
      expect(res.status).toBe(500);
    });
  });
});
