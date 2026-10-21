import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PUT } from '@/app/api/conversations/[id]/messages/[messageId]/route';
import { prisma, resetDb, jsonRequest } from './helpers/db';
import {
  MAX_ASSISTANT_MESSAGE_LENGTH,
  MAX_MESSAGE_LENGTH,
} from '@/lib/validation';

/**
 * `PUT /api/conversations/[id]/messages/[messageId]`（再生成した応答での置き換え。#9）の IT。
 * 本文・metadata・createdAt の置き換え、会話の updatedAt 更新、置き換えられる対象の制限
 * （同じ会話の assistant の応答だけ）を実 DB に対して検証する。
 */
const URL = 'http://localhost/api/conversations/x/messages/y';
const NONEXISTENT = '00000000-0000-0000-0000-000000000000';
/** UUID 形式でない ID。`id` 列は TEXT なので Prisma は例外を投げず、検証が無いと 404 に化ける。 */
const NOT_UUID = 'not-a-uuid';

/**
 * 動的ルート `[id]/messages/[messageId]` の handler に渡すコンテキスト。
 *
 * @param id - 会話 ID
 * @param messageId - メッセージ ID
 * @returns handler 第 2 引数のコンテキスト（`params` は Next.js の仕様どおり Promise）
 */
function context(id: string, messageId: string) {
  return { params: Promise.resolve({ id, messageId }) };
}

/**
 * 質問と応答が 1 往復ある会話を作る。応答の createdAt は過去にずらす（置き換えで更新されることを見るため）。
 *
 * @returns 会話 ID・質問の ID・応答の ID
 */
async function createExchange(): Promise<{
  conversationId: string;
  userId: string;
  assistantId: string;
}> {
  const conv = await prisma.conversation.create({
    data: { title: '再生成用会話', updatedAt: new Date('2020-01-01') },
  });
  const user = await prisma.message.create({
    data: { conversationId: conv.id, role: 'user', content: '質問' },
  });
  const assistant = await prisma.message.create({
    data: {
      conversationId: conv.id,
      role: 'assistant',
      content: '旧回答',
      metadata: { thinkingText: '旧思考', interrupted: true },
      createdAt: new Date('2020-01-01'),
    },
  });
  return {
    conversationId: conv.id,
    userId: user.id,
    assistantId: assistant.id,
  };
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('PUT /api/conversations/[id]/messages/[messageId]（置き換え）', () => {
  describe('正常系', () => {
    it('応答の本文・metadata・createdAt を置き換え、会話の updatedAt も更新する', async () => {
      const { conversationId, assistantId } = await createExchange();

      const res = await PUT(
        jsonRequest(URL, 'PUT', {
          content: '新回答',
          metadata: { agentRounds: 1 },
        }),
        context(conversationId, assistantId)
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(assistantId);
      expect(body.content).toBe('新回答');

      const stored = await prisma.message.findUnique({
        where: { id: assistantId },
      });
      expect(stored?.content).toBe('新回答');
      // 旧応答の metadata（思考・中断マーク）は残らず、新しい内容だけになる
      expect(stored?.metadata).toEqual({ agentRounds: 1 });
      expect(stored!.createdAt.getTime()).toBeGreaterThan(
        new Date('2020-01-01').getTime()
      );
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
      });
      expect(conv!.updatedAt.getTime()).toBeGreaterThan(
        new Date('2020-01-01').getTime()
      );
      // 件数は変わらない（追加ではなく置き換え）
      expect(await prisma.message.count()).toBe(2);
    });
  });

  describe('準正常系', () => {
    it('metadata を省略すると旧応答の metadata を消す', async () => {
      const { conversationId, assistantId } = await createExchange();

      const res = await PUT(
        jsonRequest(URL, 'PUT', { content: '新回答' }),
        context(conversationId, assistantId)
      );
      expect(res.status).toBe(200);
      const stored = await prisma.message.findUnique({
        where: { id: assistantId },
      });
      expect(stored?.metadata).toBeNull();
    });

    it('user の上限を超える本文も置き換えられる（assistant の上限で検証する）', async () => {
      const { conversationId, assistantId } = await createExchange();
      const content = 'あ'.repeat(MAX_MESSAGE_LENGTH + 1);

      const res = await PUT(
        jsonRequest(URL, 'PUT', { content }),
        context(conversationId, assistantId)
      );
      expect(res.status).toBe(200);
    });
  });

  describe('異常系', () => {
    it('user のメッセージは置き換えられず 404（質問を書き換えさせない）', async () => {
      const { conversationId, userId } = await createExchange();

      const res = await PUT(
        jsonRequest(URL, 'PUT', { content: '書き換え' }),
        context(conversationId, userId)
      );
      expect(res.status).toBe(404);
      expect(
        (await prisma.message.findUnique({ where: { id: userId } }))?.content
      ).toBe('質問');
    });

    it('別の会話の応答は置き換えられず 404', async () => {
      const { assistantId } = await createExchange();
      const other = await prisma.conversation.create({
        data: { title: '別の会話' },
      });

      const res = await PUT(
        jsonRequest(URL, 'PUT', { content: '書き換え' }),
        context(other.id, assistantId)
      );
      expect(res.status).toBe(404);
      expect(
        (await prisma.message.findUnique({ where: { id: assistantId } }))
          ?.content
      ).toBe('旧回答');
    });

    it('存在しない応答は 404（会話の updatedAt は変わらない）', async () => {
      const { conversationId } = await createExchange();

      const res = await PUT(
        jsonRequest(URL, 'PUT', { content: '新回答' }),
        context(conversationId, NONEXISTENT)
      );
      expect(res.status).toBe(404);
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
      });
      expect(conv!.updatedAt).toEqual(new Date('2020-01-01'));
    });

    it.each([
      ['会話 ID', NOT_UUID, NONEXISTENT],
      ['メッセージ ID', NONEXISTENT, NOT_UUID],
    ])('%sが UUID 形式でなければ 400', async (_label, id, messageId) => {
      const res = await PUT(
        jsonRequest(URL, 'PUT', { content: '新回答' }),
        context(id, messageId)
      );
      expect(res.status).toBe(400);
    });

    it.each([
      ['不正な JSON', 'not-json'],
      ['ボディが null', null],
      ['content が空', { content: '' }],
      ['metadata が配列', { content: 'x', metadata: [1] }],
      [
        'content が上限超過',
        { content: 'あ'.repeat(MAX_ASSISTANT_MESSAGE_LENGTH + 1) },
      ],
    ])('%sなら 400（応答は書き換わらない）', async (_label, body) => {
      const { conversationId, assistantId } = await createExchange();

      const res = await PUT(
        jsonRequest(URL, 'PUT', body),
        context(conversationId, assistantId)
      );
      expect(res.status).toBe(400);
      expect(typeof (await res.json()).error).toBe('string');
      expect(
        (await prisma.message.findUnique({ where: { id: assistantId } }))
          ?.content
      ).toBe('旧回答');
    });

    it('会話の updatedAt 更新に失敗すると置き換えもロールバックされ 500', async () => {
      const { conversationId, assistantId } = await createExchange();
      // Prisma をモックせず、実 DB 側で Conversation の UPDATE だけを失敗させる
      // （messages.test.ts の POST と同じ障害注入）
      await prisma.$executeRaw`
        CREATE FUNCTION fail_conversation_update() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'injected failure';
        END;
        $$ LANGUAGE plpgsql`;
      await prisma.$executeRaw`
        CREATE TRIGGER fail_conversation_update
        BEFORE UPDATE ON "Conversation"
        FOR EACH ROW EXECUTE FUNCTION fail_conversation_update()`;
      try {
        const res = await PUT(
          jsonRequest(URL, 'PUT', { content: '新回答' }),
          context(conversationId, assistantId)
        );
        expect(res.status).toBe(500);
        expect(
          (await prisma.message.findUnique({ where: { id: assistantId } }))
            ?.content
        ).toBe('旧回答');
      } finally {
        await prisma.$executeRaw`DROP TRIGGER fail_conversation_update ON "Conversation"`;
        await prisma.$executeRaw`DROP FUNCTION fail_conversation_update()`;
      }
    });
  });
});
