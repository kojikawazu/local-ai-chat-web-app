import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { GET, POST } from '@/app/api/conversations/[id]/messages/route';
import { prisma, resetDb, jsonRequest, routeContext } from './helpers/db';
import {
  MAX_ASSISTANT_MESSAGE_LENGTH,
  MAX_MESSAGE_LENGTH,
} from '@/lib/validation';

/**
 * `/api/conversations/[id]/messages`（取得・保存）の IT。
 * メッセージ永続化・並び順・バリデーション・会話存在チェック・updatedAt 更新を
 * 実 DB に対して検証する。
 */
const URL = 'http://localhost/api/conversations/x/messages';
const NONEXISTENT = '00000000-0000-0000-0000-000000000000';
/** UUID 形式でない ID。`id` 列は TEXT なので Prisma は例外を投げず、検証が無いと 404 に化ける。 */
const NOT_UUID = 'not-a-uuid';

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
        routeContext(id)
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.role).toBe('user');
      expect(body.content).toBe('こんにちは');
      expect(body.conversationId).toBe(id);

      // DB に永続化 + 会話の updatedAt が進む（>= 元の値）
      const stored = await prisma.message.findUnique({
        where: { id: body.id },
      });
      expect(stored?.content).toBe('こんにちは');
      const after = await prisma.conversation.findUnique({ where: { id } });
      expect(after!.updatedAt.getTime()).toBeGreaterThanOrEqual(
        before!.updatedAt.getTime()
      );
    });

    it('metadata 付きメッセージを保存できる', async () => {
      const id = await createConversation();
      const res = await POST(
        jsonRequest(URL, 'POST', {
          role: 'assistant',
          content: '結果',
          metadata: { toolCalls: [{ name: 'calculate', result: '4' }] },
        }),
        routeContext(id)
      );
      expect(res.status).toBe(201);
      const stored = await prisma.message.findUnique({
        where: { id: (await res.json()).id },
      });
      expect(stored?.metadata).toEqual({
        toolCalls: [{ name: 'calculate', result: '4' }],
      });
    });

    it('エージェント応答の metadata 4 項目を保存し、GET で同じ内容を返す（#94）', async () => {
      const id = await createConversation();
      const metadata = {
        toolCalls: [
          {
            name: 'get_current_datetime',
            arguments: { timezone: 'Asia/Tokyo' },
            result: '2026-10-17T21:25:52+09:00',
            isError: false,
            durationMs: 1,
          },
        ],
        thinkingText: '時刻を調べる\n\n答える',
        agentRounds: 2,
        agentDurationMs: 14800,
      };
      await POST(
        jsonRequest(URL, 'POST', {
          role: 'assistant',
          content: '今です',
          metadata,
        }),
        routeContext(id)
      );

      const res = await GET(jsonRequest(URL, 'GET'), routeContext(id));
      const { messages } = await res.json();
      expect(messages[0].metadata).toEqual(metadata);
    });

    it('assistant 応答は入力上限を超えても保存できる（LLM 出力は user と別上限）', async () => {
      const id = await createConversation();
      const content = 'あ'.repeat(MAX_MESSAGE_LENGTH + 1);
      const res = await POST(
        jsonRequest(URL, 'POST', { role: 'assistant', content }),
        routeContext(id)
      );
      expect(res.status).toBe(201);
      // 表示内容と永続化内容が食い違わない（切り詰められていない）
      const stored = await prisma.message.findUnique({
        where: { id: (await res.json()).id },
      });
      expect(stored?.content).toBe(content);
    });
  });

  describe('準正常系', () => {
    it('assistant ロールも保存できる', async () => {
      const id = await createConversation();
      const res = await POST(
        jsonRequest(URL, 'POST', { role: 'assistant', content: '応答' }),
        routeContext(id)
      );
      expect(res.status).toBe(201);
    });

    it('ツール呼び出しが無く思考過程と統計だけの metadata も保存される（#94）', async () => {
      const id = await createConversation();
      const metadata = {
        thinkingText: '挨拶を返す',
        agentRounds: 1,
        agentDurationMs: 3000,
      };
      const res = await POST(
        jsonRequest(URL, 'POST', {
          role: 'assistant',
          content: 'やあ',
          metadata,
        }),
        routeContext(id)
      );
      expect(res.status).toBe(201);
      const stored = await prisma.message.findUnique({
        where: { id: (await res.json()).id },
      });
      expect(stored?.metadata).toEqual(metadata);
    });

    it('metadata が null なら metadata 無しで保存される', async () => {
      const id = await createConversation();
      const res = await POST(
        jsonRequest(URL, 'POST', {
          role: 'user',
          content: 'x',
          metadata: null,
        }),
        routeContext(id)
      );
      expect(res.status).toBe(201);
      const stored = await prisma.message.findUnique({
        where: { id: (await res.json()).id },
      });
      expect(stored?.metadata).toBeNull();
    });

    it('content がちょうど上限文字数なら保存できる（境界値）', async () => {
      const id = await createConversation();
      const res = await POST(
        jsonRequest(URL, 'POST', {
          role: 'user',
          content: 'あ'.repeat(MAX_MESSAGE_LENGTH),
        }),
        routeContext(id)
      );
      expect(res.status).toBe(201);
    });

    it('assistant 応答がちょうど上限文字数なら保存できる（境界値）', async () => {
      const id = await createConversation();
      const res = await POST(
        jsonRequest(URL, 'POST', {
          role: 'assistant',
          content: 'あ'.repeat(MAX_ASSISTANT_MESSAGE_LENGTH),
        }),
        routeContext(id)
      );
      expect(res.status).toBe(201);
    });
  });

  describe('異常系', () => {
    it('不正な JSON ボディは 400', async () => {
      const id = await createConversation();
      const res = await POST(
        jsonRequest(URL, 'POST', 'not-json'),
        routeContext(id)
      );
      expect(res.status).toBe(400);
    });

    it('content 欠落は 400', async () => {
      const id = await createConversation();
      const res = await POST(
        jsonRequest(URL, 'POST', { role: 'user' }),
        routeContext(id)
      );
      expect(res.status).toBe(400);
    });

    it('許可外ロール（system）は 400', async () => {
      const id = await createConversation();
      const res = await POST(
        jsonRequest(URL, 'POST', { role: 'system', content: 'x' }),
        routeContext(id)
      );
      expect(res.status).toBe(400);
    });

    it('存在しない会話への保存は 404', async () => {
      const res = await POST(
        jsonRequest(URL, 'POST', { role: 'user', content: 'x' }),
        routeContext(NONEXISTENT)
      );
      expect(res.status).toBe(404);
    });

    it('UUID 形式でない ID は 400（DB には保存されない）', async () => {
      const res = await POST(
        jsonRequest(URL, 'POST', { role: 'user', content: 'x' }),
        routeContext(NOT_UUID)
      );
      expect(res.status).toBe(400);
      expect(await prisma.message.count()).toBe(0);
    });

    it('metadata が配列なら 400（黙って捨てずに弾く）', async () => {
      const id = await createConversation();
      const res = await POST(
        jsonRequest(URL, 'POST', {
          role: 'user',
          content: 'x',
          metadata: [1, 2],
        }),
        routeContext(id)
      );
      expect(res.status).toBe(400);
      expect(await prisma.message.count()).toBe(0);
    });

    it('metadata が文字列なら 400', async () => {
      const id = await createConversation();
      const res = await POST(
        jsonRequest(URL, 'POST', {
          role: 'user',
          content: 'x',
          metadata: 'oops',
        }),
        routeContext(id)
      );
      expect(res.status).toBe(400);
      expect(await prisma.message.count()).toBe(0);
    });

    it('content が上限文字数を超えると 400（DB には保存されない）', async () => {
      const id = await createConversation();
      const res = await POST(
        jsonRequest(URL, 'POST', {
          role: 'user',
          content: 'あ'.repeat(MAX_MESSAGE_LENGTH + 1),
        }),
        routeContext(id)
      );
      expect(res.status).toBe(400);
      // 長さ検証は会話存在チェックより前に走るため、DB は一切変更されない
      expect(await prisma.message.count()).toBe(0);
    });

    it('assistant 応答が上限文字数を超えると 400（DB には保存されない）', async () => {
      const id = await createConversation();
      const res = await POST(
        jsonRequest(URL, 'POST', {
          role: 'assistant',
          content: 'あ'.repeat(MAX_ASSISTANT_MESSAGE_LENGTH + 1),
        }),
        routeContext(id)
      );
      expect(res.status).toBe(400);
      expect(await prisma.message.count()).toBe(0);
    });

    it('会話の updatedAt 更新に失敗するとメッセージ作成もロールバックされ 500', async () => {
      const id = await createConversation();
      // Prisma をモックせず、実 DB 側に障害を注入する: Conversation の UPDATE だけを
      // 失敗させるトリガー。message.create は成功するため、トランザクションで
      // まとめていなければ「メッセージだけ保存された」部分成功が残る
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
        const res = await POST(
          jsonRequest(URL, 'POST', { role: 'user', content: 'x' }),
          routeContext(id)
        );
        expect(res.status).toBe(500);
        expect(await prisma.message.count()).toBe(0);
      } finally {
        await prisma.$executeRaw`DROP TRIGGER fail_conversation_update ON "Conversation"`;
        await prisma.$executeRaw`DROP FUNCTION fail_conversation_update()`;
      }
    });
  });
});

describe('GET /api/conversations/[id]/messages（取得）', () => {
  describe('正常系', () => {
    it('メッセージを作成日時の昇順で返す', async () => {
      const id = await createConversation();
      await prisma.message.create({
        data: { conversationId: id, role: 'user', content: '1番目' },
      });
      await prisma.message.create({
        data: { conversationId: id, role: 'assistant', content: '2番目' },
      });

      const res = await GET(jsonRequest(URL, 'GET'), routeContext(id));
      expect(res.status).toBe(200);
      const { messages } = await res.json();
      expect(messages.map((m: { content: string }) => m.content)).toEqual([
        '1番目',
        '2番目',
      ]);
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

    it('UUID 形式でない ID は 400（存在しない会話の 404 と区別する）', async () => {
      const res = await GET(jsonRequest(URL, 'GET'), routeContext(NOT_UUID));
      expect(res.status).toBe(400);
    });
  });
});
