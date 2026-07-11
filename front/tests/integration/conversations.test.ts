import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { GET, POST } from '@/app/api/conversations/route';
import { prisma, resetDb, jsonRequest } from './helpers/db';

/**
 * `/api/conversations`（一覧取得・新規作成）の IT。
 * 実 PostgreSQL（Testcontainers）に対して route handler を直接叩き、handler↔Prisma↔DB の
 * 配線を検証する。外部依存（Ollama/Web）は使わないためスタブ不要。
 */
const URL = 'http://localhost/api/conversations';

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /api/conversations（作成）', () => {
  describe('正常系', () => {
    it('title 指定で会話を作成し 201 を返す', async () => {
      const res = await POST(jsonRequest(URL, 'POST', { title: 'テスト会話' }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.title).toBe('テスト会話');
      expect(body.id).toMatch(/^[0-9a-f-]{36}$/i);
      // DB に実際に永続化されている
      const stored = await prisma.conversation.findUnique({ where: { id: body.id } });
      expect(stored?.title).toBe('テスト会話');
    });

    it('title 未指定なら既定タイトル「新しい会話」で作成する', async () => {
      const res = await POST(jsonRequest(URL, 'POST', {}));
      expect(res.status).toBe(201);
      expect((await res.json()).title).toBe('新しい会話');
    });
  });

  describe('準正常系', () => {
    it('空文字 title は既定タイトルにフォールバックする', async () => {
      const res = await POST(jsonRequest(URL, 'POST', { title: '' }));
      expect((await res.json()).title).toBe('新しい会話');
    });

    it('空白のみ title はトリムされ既定タイトルになる', async () => {
      const res = await POST(jsonRequest(URL, 'POST', { title: '   ' }));
      expect((await res.json()).title).toBe('新しい会話');
    });

    it('不正な JSON ボディでも既定タイトルで作成する（body 解析失敗は握りつぶす契約）', async () => {
      const res = await POST(jsonRequest(URL, 'POST', 'not-json'));
      expect(res.status).toBe(201);
      expect((await res.json()).title).toBe('新しい会話');
    });
  });
});

describe('GET /api/conversations（一覧）', () => {
  describe('正常系', () => {
    it('作成した会話を更新日時の降順（最新が先頭）で返す', async () => {
      const first = await prisma.conversation.create({ data: { title: '古い' } });
      const second = await prisma.conversation.create({ data: { title: '新しい' } });
      // second を更新して updatedAt を確実に後にする
      await prisma.conversation.update({
        where: { id: second.id },
        data: { updatedAt: new Date() },
      });

      const res = await GET();
      expect(res.status).toBe(200);
      const { conversations } = await res.json();
      expect(conversations).toHaveLength(2);
      expect(conversations[0].id).toBe(second.id);
      expect(conversations[1].id).toBe(first.id);
      // 一覧は id/title/createdAt/updatedAt のみ返す
      expect(Object.keys(conversations[0]).sort()).toEqual(
        ['createdAt', 'id', 'title', 'updatedAt'],
      );
    });
  });

  describe('準正常系', () => {
    it('会話が0件のとき空配列を返す', async () => {
      const res = await GET();
      expect(res.status).toBe(200);
      expect((await res.json()).conversations).toEqual([]);
    });
  });
});
