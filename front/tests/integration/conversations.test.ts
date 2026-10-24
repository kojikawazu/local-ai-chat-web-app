import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { GET, POST } from '@/app/api/conversations/route';
import { prisma, resetDb, jsonRequest } from './helpers/db';
import {
  MAX_CONVERSATION_SYSTEM_PROMPT_LENGTH,
  MAX_TITLE_LENGTH,
} from '@/lib/shared/validation';

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
      const stored = await prisma.conversation.findUnique({
        where: { id: body.id },
      });
      expect(stored?.title).toBe('テスト会話');
    });

    it('systemPrompt（会話の役割）を前後の空白を除いて保存する（#10）', async () => {
      const res = await POST(
        jsonRequest(URL, 'POST', {
          title: '翻訳',
          systemPrompt: ' あなたは翻訳者です。 ',
        })
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.systemPrompt).toBe('あなたは翻訳者です。');
      const stored = await prisma.conversation.findUnique({
        where: { id: body.id },
      });
      expect(stored?.systemPrompt).toBe('あなたは翻訳者です。');
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

    it('ボディを省略すると既定タイトルで作成する', async () => {
      const res = await POST(jsonRequest(URL, 'POST'));
      expect(res.status).toBe(201);
      expect((await res.json()).title).toBe('新しい会話');
    });

    it.each([
      ['未指定', {}],
      ['空白のみ', { systemPrompt: '  ' }],
      ['null', { systemPrompt: null }],
    ])(
      'systemPrompt が%sなら役割なし（null）で作成する',
      async (_label, body) => {
        const res = await POST(jsonRequest(URL, 'POST', body));
        expect(res.status).toBe(201);
        expect((await res.json()).systemPrompt).toBeNull();
      }
    );

    it('title がちょうど上限文字数なら作成できる（境界値）', async () => {
      const title = 'あ'.repeat(MAX_TITLE_LENGTH);
      const res = await POST(jsonRequest(URL, 'POST', { title }));
      expect(res.status).toBe(201);
      expect((await res.json()).title).toBe(title);
    });
  });

  describe('異常系', () => {
    it('title が上限文字数を超えると 400（DB には保存されない）', async () => {
      const res = await POST(
        jsonRequest(URL, 'POST', { title: 'あ'.repeat(MAX_TITLE_LENGTH + 1) })
      );
      expect(res.status).toBe(400);
      expect(await prisma.conversation.count()).toBe(0);
    });

    // 以前は構文エラーを握りつぶして既定タイトルで作成し、null や数値の title は 500 になっていた（#95）。
    // 空のボディだけを「省略」とみなし、中身があるのに形が合わないものは 400 にそろえる
    it.each([
      ['構文が不正な JSON', 'not-json'],
      ['ボディが null', null],
      ['ボディが配列', []],
      ['title が数値', { title: 123 }],
      ['systemPrompt が数値', { systemPrompt: 1 }],
      [
        'systemPrompt が上限超過',
        {
          systemPrompt: 'あ'.repeat(MAX_CONVERSATION_SYSTEM_PROMPT_LENGTH + 1),
        },
      ],
    ])('%sなら 400（DB には保存されない）', async (_label, body) => {
      const res = await POST(jsonRequest(URL, 'POST', body));
      expect(res.status).toBe(400);
      expect(typeof (await res.json()).error).toBe('string');
      expect(await prisma.conversation.count()).toBe(0);
    });
  });
});

describe('GET /api/conversations（一覧）', () => {
  describe('正常系', () => {
    it('作成した会話を更新日時の降順（最新が先頭）で返す', async () => {
      const first = await prisma.conversation.create({
        data: { title: '古い' },
      });
      const second = await prisma.conversation.create({
        data: { title: '新しい' },
      });
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
      // 一覧は id/title/systemPrompt/createdAt/updatedAt のみ返す
      expect(Object.keys(conversations[0]).sort()).toEqual([
        'createdAt',
        'id',
        'systemPrompt',
        'title',
        'updatedAt',
      ]);
    });
  });

  describe('準正常系', () => {
    it('会話が0件のとき空配列を返す', async () => {
      const res = await GET();
      expect(res.status).toBe(200);
      expect((await res.json()).conversations).toEqual([]);
    });

    it('title が空文字の会話でも一覧に含めて返す', async () => {
      // DB に直接入れた異常データ（API 経由では既定タイトルになる）でも
      // 一覧取得が落ちないことを確認する
      await prisma.conversation.create({ data: { title: '' } });
      const res = await GET();
      expect(res.status).toBe(200);
      const { conversations } = await res.json();
      expect(conversations).toHaveLength(1);
      expect(conversations[0].title).toBe('');
    });
  });

  // 異常系: このエンドポイントは引数を取らないため、入力起因の失敗経路が存在しない。
  // 残る失敗経路は DB 接続断（→ 500）のみだが、それを検証するには Prisma を
  // モックする必要があり、IT の方針（実 DB を使い、mock は真の外部のみ）に反する。
  // そのため GET 単体の異常系ケースは置かない（POST 側で異常系を担保しており、
  // testing.md の 3 分類要件はファイル単位で満たしている）。
});
