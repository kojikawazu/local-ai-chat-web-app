import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { GET as getAttachment } from '@/app/api/attachments/[id]/route';
import {
  GET as getMessages,
  POST as saveMessage,
} from '@/app/api/conversations/[id]/messages/route';
import { DELETE as deleteConversation } from '@/app/api/conversations/[id]/route';
import { prisma, resetDb, jsonRequest, routeContext } from './helpers/db';

/**
 * 添付画像（#6）の保存・一覧・取得の IT。
 * user メッセージと添付を 1 トランザクションで保存すること、一覧に中身を含めないこと、
 * 取得 API が中身から判定した形式で返すこと、会話の削除で添付も消えることを実 DB に対して検証する。
 */
const MESSAGES_URL = 'http://localhost/api/conversations/x/messages';
const ATTACHMENT_URL = 'http://localhost/api/attachments/x';
const NONEXISTENT = '00000000-0000-0000-0000-000000000000';

/**
 * 先頭だけが PNG のシグネチャのバイト列。サーバーは先頭で形式を判定するだけのため、これで足りる。
 */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03,
]);
/** 先頭だけが JPEG の SOI マーカーのバイト列。 */
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x04, 0x05]);

/**
 * 保存 API の添付 1 枚を組み立てる。
 *
 * @param bytes - 画像のバイト列
 * @returns `{ id, data, width, height }` の添付
 */
function attachment(bytes: Uint8Array = PNG_BYTES) {
  return {
    id: crypto.randomUUID(),
    data: Buffer.from(bytes).toString('base64'),
    width: 320,
    height: 200,
  };
}

/** テスト用の会話を1件作成して ID を返す。 */
async function createConversation(): Promise<string> {
  const conv = await prisma.conversation.create({ data: { title: '画像' } });
  return conv.id;
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /api/conversations/[id]/messages（添付の保存）', () => {
  describe('正常系', () => {
    it('user メッセージと添付を保存し、形式は中身から判定して保存する', async () => {
      const conversationId = await createConversation();
      const png = attachment();
      const jpeg = attachment(JPEG_BYTES);

      const res = await saveMessage(
        jsonRequest(MESSAGES_URL, 'POST', {
          role: 'user',
          content: 'これは？',
          attachments: [png, jpeg],
        }),
        routeContext(conversationId)
      );
      expect(res.status).toBe(201);
      const message = await res.json();

      const stored = await prisma.attachment.findMany({
        where: { messageId: message.id },
        orderBy: { position: 'asc' },
      });
      expect(
        stored.map((a) => [a.id, a.position, a.mimeType, a.size, a.width])
      ).toEqual([
        [png.id, 0, 'image/png', PNG_BYTES.length, 320],
        [jpeg.id, 1, 'image/jpeg', JPEG_BYTES.length, 320],
      ]);
      expect(new Uint8Array(stored[0].data)).toEqual(PNG_BYTES);
    });
  });

  describe('準正常系', () => {
    it('同じメッセージ ID の再送は 409 で、添付は増えない（保存の再試行）', async () => {
      const conversationId = await createConversation();
      const body = {
        id: crypto.randomUUID(),
        role: 'user',
        content: 'これは？',
        attachments: [attachment()],
      };

      await saveMessage(
        jsonRequest(MESSAGES_URL, 'POST', body),
        routeContext(conversationId)
      );
      const retry = await saveMessage(
        jsonRequest(MESSAGES_URL, 'POST', body),
        routeContext(conversationId)
      );
      expect(retry.status).toBe(409);
      expect(await prisma.attachment.count()).toBe(1);
    });
  });

  describe('異常系', () => {
    it('assistant の添付は 400 で、メッセージも保存しない', async () => {
      const conversationId = await createConversation();

      const res = await saveMessage(
        jsonRequest(MESSAGES_URL, 'POST', {
          role: 'assistant',
          content: '回答',
          attachments: [attachment()],
        }),
        routeContext(conversationId)
      );
      expect(res.status).toBe(400);
      expect(await prisma.message.count()).toBe(0);
    });

    it('PNG / JPEG でない添付は 400 で、メッセージも保存しない', async () => {
      const conversationId = await createConversation();

      const res = await saveMessage(
        jsonRequest(MESSAGES_URL, 'POST', {
          role: 'user',
          content: 'これは？',
          attachments: [attachment(new TextEncoder().encode('<svg></svg>'))],
        }),
        routeContext(conversationId)
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(
        '画像はPNGかJPEGで指定してください'
      );
      expect(await prisma.message.count()).toBe(0);
    });

    it('別のメッセージの添付と同じ ID なら 409 で、メッセージも保存しない（1 トランザクション）', async () => {
      const conversationId = await createConversation();
      const shared = attachment();
      await saveMessage(
        jsonRequest(MESSAGES_URL, 'POST', {
          role: 'user',
          content: '1 通目',
          attachments: [shared],
        }),
        routeContext(conversationId)
      );

      const res = await saveMessage(
        jsonRequest(MESSAGES_URL, 'POST', {
          role: 'user',
          content: '2 通目',
          attachments: [shared],
        }),
        routeContext(conversationId)
      );
      expect(res.status).toBe(409);
      expect(await prisma.message.count()).toBe(1);
    });
  });
});

describe('GET /api/conversations/[id]/messages（添付の情報）', () => {
  describe('正常系', () => {
    it('添付の ID・形式・寸法を並び順で返し、中身は含めない', async () => {
      const conversationId = await createConversation();
      const first = attachment(JPEG_BYTES);
      const second = attachment();
      await saveMessage(
        jsonRequest(MESSAGES_URL, 'POST', {
          role: 'user',
          content: 'これは？',
          attachments: [first, second],
        }),
        routeContext(conversationId)
      );

      const res = await getMessages(
        jsonRequest(MESSAGES_URL, 'GET'),
        routeContext(conversationId)
      );
      const { messages } = await res.json();
      expect(messages[0].attachments).toEqual([
        { id: first.id, mimeType: 'image/jpeg', width: 320, height: 200 },
        { id: second.id, mimeType: 'image/png', width: 320, height: 200 },
      ]);
    });
  });

  describe('準正常系', () => {
    it('添付の無いメッセージは空配列', async () => {
      const conversationId = await createConversation();
      await saveMessage(
        jsonRequest(MESSAGES_URL, 'POST', { role: 'user', content: 'やあ' }),
        routeContext(conversationId)
      );

      const res = await getMessages(
        jsonRequest(MESSAGES_URL, 'GET'),
        routeContext(conversationId)
      );
      expect((await res.json()).messages[0].attachments).toEqual([]);
    });
  });

  // 異常系（不正な ID・存在しない会話）は添付と関係なく messages.test.ts で確かめている
});

describe('GET /api/attachments/[id]', () => {
  describe('正常系', () => {
    it('画像の中身を、保存した形式の Content-Type・nosniff・長いキャッシュで返す', async () => {
      const conversationId = await createConversation();
      const png = attachment();
      await saveMessage(
        jsonRequest(MESSAGES_URL, 'POST', {
          role: 'user',
          content: 'これは？',
          attachments: [png],
        }),
        routeContext(conversationId)
      );

      const res = await getAttachment(
        jsonRequest(ATTACHMENT_URL, 'GET'),
        routeContext(png.id)
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/png');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('Cache-Control')).toContain('immutable');
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_BYTES);
    });
  });

  describe('準正常系', () => {
    it('会話を削除すると、添付も消えて 404 になる（Cascade）', async () => {
      const conversationId = await createConversation();
      const png = attachment();
      await saveMessage(
        jsonRequest(MESSAGES_URL, 'POST', {
          role: 'user',
          content: 'これは？',
          attachments: [png],
        }),
        routeContext(conversationId)
      );

      await deleteConversation(
        jsonRequest('http://localhost/api/conversations/x', 'DELETE'),
        routeContext(conversationId)
      );

      const res = await getAttachment(
        jsonRequest(ATTACHMENT_URL, 'GET'),
        routeContext(png.id)
      );
      expect(res.status).toBe(404);
      expect(await prisma.attachment.count()).toBe(0);
    });
  });

  describe('異常系', () => {
    it('UUID 形式でない ID は 400', async () => {
      const res = await getAttachment(
        jsonRequest(ATTACHMENT_URL, 'GET'),
        routeContext('not-a-uuid')
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: '無効な添付IDです' });
    });

    it('存在しない ID は 404', async () => {
      const res = await getAttachment(
        jsonRequest(ATTACHMENT_URL, 'GET'),
        routeContext(NONEXISTENT)
      );
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: '添付が見つかりません' });
    });
  });
});
