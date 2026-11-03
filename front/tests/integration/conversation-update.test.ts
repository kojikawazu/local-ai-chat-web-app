import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PATCH } from '@/app/api/conversations/[id]/route';
import { prisma, resetDb, jsonRequest, routeContext } from './helpers/db';
import { MAX_CONVERSATION_SYSTEM_PROMPT_LENGTH } from '@/lib/shared/validation';

/**
 * `PATCH /api/conversations/[id]`（会話の役割の変更。#10。ドキュメントの参照の切り替え。#17 Phase B）の IT。
 * 役割の保存・外す操作・ドキュメントの参照の切り替え・変更できる項目の制限・400 / 404 / 500 の区別を実 DB に対して検証する。
 */
const URL = 'http://localhost/api/conversations/x';
const NONEXISTENT = '00000000-0000-0000-0000-000000000000';

/**
 * 役割付きの会話を作る。更新日時は過去にずらす（変更で更新されることを見るため）。
 *
 * @param systemPrompt - 会話の役割（省略時は役割なし）
 * @returns 作成した会話
 */
async function createConversation(systemPrompt: string | null = null) {
  return prisma.conversation.create({
    data: {
      title: '役割テスト',
      systemPrompt,
      updatedAt: new Date('2020-01-01'),
    },
  });
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('PATCH /api/conversations/[id]（役割の変更）', () => {
  describe('正常系', () => {
    it('役割を保存し、変更後の会話を返す（更新日時も新しくなる）', async () => {
      const conv = await createConversation();

      const res = await PATCH(
        jsonRequest(URL, 'PATCH', { systemPrompt: ' あなたは翻訳者です。 ' }),
        routeContext(conv.id)
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        id: conv.id,
        title: '役割テスト',
        systemPrompt: 'あなたは翻訳者です。',
      });
      expect(Object.keys(body).sort()).toEqual([
        'createdAt',
        'forkedFrom',
        'id',
        'knowledgeEnabled',
        'systemPrompt',
        'title',
        'updatedAt',
      ]);

      const stored = await prisma.conversation.findUnique({
        where: { id: conv.id },
      });
      expect(stored?.systemPrompt).toBe('あなたは翻訳者です。');
      expect(stored!.updatedAt.getTime()).toBeGreaterThan(
        new Date('2020-01-01').getTime()
      );
    });
  });

  describe('準正常系', () => {
    it('knowledgeEnabled だけを送ると、ドキュメントの参照だけを変え、役割は変えない（#17 Phase B）', async () => {
      const conv = await createConversation('旧い役割');

      const on = await PATCH(
        jsonRequest(URL, 'PATCH', { knowledgeEnabled: true }),
        routeContext(conv.id)
      );
      expect(on.status).toBe(200);
      expect(await on.json()).toMatchObject({
        knowledgeEnabled: true,
        systemPrompt: '旧い役割',
      });

      const off = await PATCH(
        jsonRequest(URL, 'PATCH', { knowledgeEnabled: false }),
        routeContext(conv.id)
      );
      expect((await off.json()).knowledgeEnabled).toBe(false);
      const stored = await prisma.conversation.findUnique({
        where: { id: conv.id },
      });
      expect(stored).toMatchObject({
        knowledgeEnabled: false,
        systemPrompt: '旧い役割',
      });
    });

    it('役割だけを送ると、ドキュメントの参照は変えない', async () => {
      const conv = await createConversation();
      await prisma.conversation.update({
        where: { id: conv.id },
        data: { knowledgeEnabled: true },
      });

      const res = await PATCH(
        jsonRequest(URL, 'PATCH', { systemPrompt: '役割' }),
        routeContext(conv.id)
      );
      expect(await res.json()).toMatchObject({
        systemPrompt: '役割',
        knowledgeEnabled: true,
      });
    });

    it.each([
      ['null', null],
      ['空文字', ''],
      ['空白のみ', '  '],
    ])('systemPrompt が%sなら役割を外す', async (_label, systemPrompt) => {
      const conv = await createConversation('旧い役割');

      const res = await PATCH(
        jsonRequest(URL, 'PATCH', { systemPrompt }),
        routeContext(conv.id)
      );
      expect(res.status).toBe(200);
      expect((await res.json()).systemPrompt).toBeNull();
    });

    it('役割以外のフィールド（title）は変更しない', async () => {
      const conv = await createConversation();

      await PATCH(
        jsonRequest(URL, 'PATCH', { systemPrompt: '役割', title: '書き換え' }),
        routeContext(conv.id)
      );

      const stored = await prisma.conversation.findUnique({
        where: { id: conv.id },
      });
      expect(stored?.title).toBe('役割テスト');
    });

    it('役割がちょうど上限なら保存できる（境界値）', async () => {
      const conv = await createConversation();
      const systemPrompt = 'あ'.repeat(MAX_CONVERSATION_SYSTEM_PROMPT_LENGTH);

      const res = await PATCH(
        jsonRequest(URL, 'PATCH', { systemPrompt }),
        routeContext(conv.id)
      );
      expect(res.status).toBe(200);
    });
  });

  describe('異常系', () => {
    it('存在しない会話は 404（DB 障害の 500 と区別する）', async () => {
      const res = await PATCH(
        jsonRequest(URL, 'PATCH', { systemPrompt: '役割' }),
        routeContext(NONEXISTENT)
      );
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe('会話が見つかりません');
    });

    it('会話 ID が UUID 形式でなければ 400', async () => {
      const res = await PATCH(
        jsonRequest(URL, 'PATCH', { systemPrompt: '役割' }),
        routeContext('not-a-uuid')
      );
      expect(res.status).toBe(400);
    });

    it.each([
      ['不正な JSON', 'not-json'],
      ['ボディが null', null],
      ['systemPrompt・knowledgeEnabled のキーが無い', {}],
      ['systemPrompt が数値', { systemPrompt: 1 }],
      ['knowledgeEnabled が文字列', { knowledgeEnabled: 'true' }],
      ['knowledgeEnabled が null', { knowledgeEnabled: null }],
      [
        'systemPrompt が上限超過',
        {
          systemPrompt: 'あ'.repeat(MAX_CONVERSATION_SYSTEM_PROMPT_LENGTH + 1),
        },
      ],
    ])('%sなら 400（役割は変わらない）', async (_label, body) => {
      const conv = await createConversation('旧い役割');

      const res = await PATCH(
        jsonRequest(URL, 'PATCH', body),
        routeContext(conv.id)
      );
      expect(res.status).toBe(400);
      expect(typeof (await res.json()).error).toBe('string');
      expect(
        (await prisma.conversation.findUnique({ where: { id: conv.id } }))
          ?.systemPrompt
      ).toBe('旧い役割');
    });

    it('DB 側で更新に失敗すると 500 を返し、役割は変わらない', async () => {
      const conv = await createConversation('旧い役割');
      // Prisma をモックせず、実 DB 側で Conversation の UPDATE だけを失敗させる
      // （conversation-delete.test.ts の DELETE と同じ障害注入）
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
        const res = await PATCH(
          jsonRequest(URL, 'PATCH', { systemPrompt: '新しい役割' }),
          routeContext(conv.id)
        );
        expect(res.status).toBe(500);
        expect((await res.json()).error).toBe('会話の更新に失敗しました');
      } finally {
        await prisma.$executeRaw`DROP TRIGGER fail_conversation_update ON "Conversation"`;
        await prisma.$executeRaw`DROP FUNCTION fail_conversation_update()`;
      }
      expect(
        (await prisma.conversation.findUnique({ where: { id: conv.id } }))
          ?.systemPrompt
      ).toBe('旧い役割');
    });
  });
});
