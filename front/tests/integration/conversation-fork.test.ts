import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { POST as FORK } from '@/app/api/conversations/[id]/fork/route';
import {
  GET as LIST_CONVERSATIONS,
  POST as CREATE_CONVERSATION,
} from '@/app/api/conversations/route';
import {
  PATCH as PATCH_CONVERSATION,
  DELETE as DELETE_CONVERSATION,
} from '@/app/api/conversations/[id]/route';
import { GET as GET_ATTACHMENT } from '@/app/api/attachments/[id]/route';
import { prisma, resetDb, jsonRequest, routeContext } from './helpers/db';

/**
 * `POST /api/conversations/[id]/fork`（会話の分岐。#29）の IT。
 * その応答までのコピー（順序・`createdAt`・metadata・添付画像とツールの画面の ID の書き換え）・
 * ブックマークをコピーしないこと・会話の一覧 / 作成 / 役割の変更の `forkedFrom`・分岐元の削除・400 / 404 を実 DB に対して検証する。
 */
const URL = 'http://localhost/api/conversations/x/fork';
const NONEXISTENT = '00000000-0000-0000-0000-000000000000';
/** UUID 形式でない ID。`id` 列は TEXT なので Prisma は例外を投げず、検証が無いと 404 に化ける。 */
const NOT_UUID = 'not-a-uuid';
/** 先頭だけが PNG のシグネチャのバイト列（添付画像のコピーの確認用） */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03,
]);
/** 先頭だけが JPEG の SOI マーカーのバイト列（ツールの画面のコピーの確認用） */
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x04, 0x05]);

/** 応答のトークン数・所要時間（#31）。分岐で metadata ごとコピーされることを確かめる */
const METRICS = {
  model: 'qwen3.8:27b',
  calls: 1,
  promptTokens: 120,
  promptCachedTokens: 0,
  maxPromptTokens: 120,
  promptDurationMs: 300,
  outputTokens: 80,
  outputDurationMs: 2000,
  loadDurationMs: 0,
  totalDurationMs: 2400,
};

/** 分岐の API が返す会話のうち、テストで見る項目 */
type ForkedConversation = {
  id: string;
  title: string;
  systemPrompt: string | null;
  forkedFrom: { conversationId: string; messageId: string; title: string };
};

/**
 * 2 往復（質問 → 応答 → 質問 → 応答）の会話を DB に直接作る。並びを確かめるため、時刻を 1 分ずつずらす。
 * 1 つ目の質問には PNG の添付画像を、1 つ目の応答には JPEG のツールの画面（metadata から ID で参照）を付ける。
 *
 * @returns 会話の ID・4 件のメッセージの ID（古い順）・添付画像とツールの画面の ID
 */
async function createConversation() {
  const conversation = await prisma.conversation.create({
    data: { title: '旅行の計画', systemPrompt: '旅行の案内係' },
  });
  const base = new Date('2026-10-31T09:00:00.000Z').getTime();
  const at = (minutes: number) => new Date(base + minutes * 60_000);
  const imageId = crypto.randomUUID();
  const screenshotId = crypto.randomUUID();

  const q1 = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: 'user',
      content: '京都の見どころは？',
      createdAt: at(0),
      attachments: {
        create: {
          id: imageId,
          position: 0,
          mimeType: 'image/png',
          width: 320,
          height: 200,
          size: PNG_BYTES.length,
          data: PNG_BYTES,
        },
      },
    },
  });
  const a1 = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: 'assistant',
      content: '清水寺です',
      createdAt: at(1),
      metadata: {
        thinking: '寺を挙げる',
        metrics: METRICS,
        toolCalls: [
          {
            name: 'browser_navigate',
            result: '開いた',
            screenshots: [
              {
                id: screenshotId,
                kind: 'after',
                mimeType: 'image/jpeg',
                width: 640,
                height: 480,
              },
            ],
          },
        ],
      },
      attachments: {
        create: {
          id: screenshotId,
          position: 0,
          mimeType: 'image/jpeg',
          width: 640,
          height: 480,
          size: JPEG_BYTES.length,
          data: JPEG_BYTES,
        },
      },
    },
  });
  const q2 = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: 'user',
      content: '大阪は？',
      createdAt: at(2),
    },
  });
  const a2 = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: 'assistant',
      content: '大阪城です',
      createdAt: at(3),
    },
  });
  return {
    conversationId: conversation.id,
    messageIds: [q1.id, a1.id, q2.id, a2.id],
    imageId,
    screenshotId,
  };
}

/**
 * 分岐の API を呼ぶ。
 *
 * @param conversationId - 分岐元の会話の ID
 * @param body - リクエストのボディ（文字列なら不正な JSON をそのまま送る）
 * @returns 応答
 */
function fork(conversationId: string, body: unknown) {
  return FORK(jsonRequest(URL, 'POST', body), routeContext(conversationId));
}

/**
 * 会話のメッセージを、表示と同じ順（`createdAt` の昇順）に添付画像付きで読む。
 *
 * @param conversationId - 会話の ID
 * @returns メッセージの一覧
 */
function readMessages(conversationId: string) {
  return prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    include: { attachments: { orderBy: { position: 'asc' } } },
  });
}

describe('POST /api/conversations/[id]/fork', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
  });

  describe('正常系', () => {
    it('途中の応答から分岐すると、その応答までを新しい会話にコピーする（201）', async () => {
      const source = await createConversation();
      const original = await readMessages(source.conversationId);

      const res = await fork(source.conversationId, {
        messageId: source.messageIds[1],
      });

      expect(res.status).toBe(201);
      const forked: ForkedConversation = await res.json();
      expect(forked.id).not.toBe(source.conversationId);
      expect(forked.title).toBe('旅行の計画（分岐）');
      expect(forked.systemPrompt).toBe('旅行の案内係');
      expect(forked.forkedFrom).toEqual({
        conversationId: source.conversationId,
        messageId: source.messageIds[1],
        title: '旅行の計画',
      });

      const copied = await readMessages(forked.id);
      expect(copied.map((m) => [m.role, m.content])).toEqual([
        ['user', '京都の見どころは？'],
        ['assistant', '清水寺です'],
      ]);
      // ID は新しく、時刻は元のまま
      expect(copied.map((m) => m.id)).not.toContain(source.messageIds[0]);
      expect(copied.map((m) => m.createdAt.toISOString())).toEqual(
        original.slice(0, 2).map((m) => m.createdAt.toISOString())
      );
      // 思考過程・トークン数（#31）も metadata ごとコピーする
      expect(copied[1].metadata).toMatchObject({
        thinking: '寺を挙げる',
        metrics: METRICS,
      });

      // 元の会話は変わらない
      expect(await readMessages(source.conversationId)).toHaveLength(4);
    });

    it('最後の応答から分岐すると、会話全体をコピーする', async () => {
      const source = await createConversation();

      const res = await fork(source.conversationId, {
        messageId: source.messageIds[3],
      });

      expect(res.status).toBe(201);
      const forked: ForkedConversation = await res.json();
      const copied = await readMessages(forked.id);
      expect(copied.map((m) => m.content)).toEqual([
        '京都の見どころは？',
        '清水寺です',
        '大阪は？',
        '大阪城です',
      ]);
    });

    it('添付画像を新しい ID で中身ごとコピーし、ツールの画面の ID を書き換える', async () => {
      const source = await createConversation();

      const res = await fork(source.conversationId, {
        messageId: source.messageIds[1],
      });
      const forked: ForkedConversation = await res.json();
      const [question, answer] = await readMessages(forked.id);

      expect(question.attachments).toHaveLength(1);
      expect(question.attachments[0].id).not.toBe(source.imageId);
      expect(new Uint8Array(question.attachments[0].data)).toEqual(PNG_BYTES);
      expect(question.attachments[0]).toMatchObject({
        mimeType: 'image/png',
        width: 320,
        height: 200,
        position: 0,
      });

      const copiedShotId = answer.attachments[0].id;
      expect(copiedShotId).not.toBe(source.screenshotId);
      expect(new Uint8Array(answer.attachments[0].data)).toEqual(JPEG_BYTES);
      expect(answer.metadata).toMatchObject({
        toolCalls: [{ screenshots: [{ id: copiedShotId, kind: 'after' }] }],
      });

      // コピーした画像は配信 API で読める
      const image = await GET_ATTACHMENT(
        jsonRequest('http://localhost/api/attachments/x', 'GET'),
        routeContext(copiedShotId)
      );
      expect(image.status).toBe(200);
      expect(image.headers.get('content-type')).toBe('image/jpeg');

      // 元の画像は元のメッセージに残る
      expect(
        await prisma.attachment.count({
          where: { id: { in: [source.imageId, source.screenshotId] } },
        })
      ).toBe(2);
    });

    it('ブックマークはコピーしない', async () => {
      const source = await createConversation();
      await prisma.bookmark.create({
        data: { messageId: source.messageIds[1] },
      });

      const res = await fork(source.conversationId, {
        messageId: source.messageIds[1],
      });
      const forked: ForkedConversation = await res.json();

      const copiedIds = (await readMessages(forked.id)).map((m) => m.id);
      expect(
        await prisma.bookmark.count({ where: { messageId: { in: copiedIds } } })
      ).toBe(0);
      expect(await prisma.bookmark.count()).toBe(1);
    });

    it('分岐した会話から分岐しても、タイトルに（分岐）を重ねない', async () => {
      const source = await createConversation();
      const first: ForkedConversation = await (
        await fork(source.conversationId, { messageId: source.messageIds[3] })
      ).json();
      const firstMessages = await readMessages(first.id);

      const res = await fork(first.id, { messageId: firstMessages[1].id });

      expect(res.status).toBe(201);
      const second: ForkedConversation = await res.json();
      expect(second.title).toBe('旅行の計画（分岐）');
      expect(second.forkedFrom.conversationId).toBe(first.id);
    });

    it('会話の一覧・作成・役割の変更が forkedFrom を返す', async () => {
      const source = await createConversation();
      const forked: ForkedConversation = await (
        await fork(source.conversationId, { messageId: source.messageIds[1] })
      ).json();

      const list = await (await LIST_CONVERSATIONS()).json();
      const byId = new Map(
        list.conversations.map((c: { id: string; forkedFrom: unknown }) => [
          c.id,
          c.forkedFrom,
        ])
      );
      expect(byId.get(source.conversationId)).toBeNull();
      expect(byId.get(forked.id)).toEqual({
        conversationId: source.conversationId,
        messageId: source.messageIds[1],
        title: '旅行の計画',
      });

      // 役割を変えた応答で一覧を差し替えても、分岐元が消えない
      const patched = await PATCH_CONVERSATION(
        jsonRequest('http://localhost/api/conversations/x', 'PATCH', {
          systemPrompt: '別の役割',
        }),
        routeContext(forked.id)
      );
      expect((await patched.json()).forkedFrom).toEqual(forked.forkedFrom);

      const created = await CREATE_CONVERSATION(
        jsonRequest('http://localhost/api/conversations', 'POST', {
          title: '新しい会話',
        })
      );
      expect((await created.json()).forkedFrom).toBeNull();
    });
  });

  describe('準正常系', () => {
    it('分岐元の会話を消すと、分岐した会話は残り forkedFrom が null になる', async () => {
      const source = await createConversation();
      const forked: ForkedConversation = await (
        await fork(source.conversationId, { messageId: source.messageIds[1] })
      ).json();

      const deleted = await DELETE_CONVERSATION(
        jsonRequest('http://localhost/api/conversations/x', 'DELETE'),
        routeContext(source.conversationId)
      );
      expect(deleted.status).toBe(200);

      const list = await (await LIST_CONVERSATIONS()).json();
      expect(list.conversations).toHaveLength(1);
      expect(list.conversations[0]).toMatchObject({
        id: forked.id,
        forkedFrom: null,
      });
      expect(await readMessages(forked.id)).toHaveLength(2);
    });

    it('user のメッセージからは分岐できない（400）', async () => {
      const source = await createConversation();

      const res = await fork(source.conversationId, {
        messageId: source.messageIds[0],
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: '分岐できるのは応答だけです' });
      expect(await prisma.conversation.count()).toBe(1);
    });

    it('別の会話の応答を指定すると 404', async () => {
      const source = await createConversation();
      const other = await createConversation();

      const res = await fork(source.conversationId, {
        messageId: other.messageIds[1],
      });

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'メッセージが見つかりません' });
    });

    it('無い会話・無いメッセージは 404', async () => {
      const source = await createConversation();

      const noConversation = await fork(NONEXISTENT, {
        messageId: source.messageIds[1],
      });
      expect(noConversation.status).toBe(404);
      expect(await noConversation.json()).toEqual({
        error: '会話が見つかりません',
      });

      const noMessage = await fork(source.conversationId, {
        messageId: NONEXISTENT,
      });
      expect(noMessage.status).toBe(404);
    });
  });

  describe('異常系', () => {
    it('会話の ID が UUID の形でなければ 400（DB を読む前に断る）', async () => {
      const res = await fork(NOT_UUID, { messageId: NONEXISTENT });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: '無効な会話IDです' });
    });

    it('messageId の不正・型違い・不正な JSON は 400', async () => {
      const source = await createConversation();

      for (const body of [
        { messageId: NOT_UUID },
        { messageId: 1 },
        {},
        null,
        '{"messageId":',
      ]) {
        const res = await fork(source.conversationId, body);
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(Object.keys(json)).toEqual(['error']);
      }
      expect(await prisma.conversation.count()).toBe(1);
    });
  });
});
