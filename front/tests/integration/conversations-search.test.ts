import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/conversations/search/route';
import { prisma, resetDb } from './helpers/db';
import {
  MAX_SEARCH_QUERY_LENGTH,
  MAX_SEARCH_TERMS,
} from '@/lib/shared/validation';
import type { ConversationSearchResult } from '@/types/conversation/conversation';

/**
 * `GET /api/conversations/search`（会話検索。#11）の IT。
 * 実 PostgreSQL（Testcontainers）に会話・メッセージを入れ、route handler を直接叩いて
 * Prisma の絞り込み（ILIKE・AND・並び・ページ分け）が DB で意図どおりに動くかを検証する。
 * 外部依存は使わないためスタブ不要。DB の障害による 500 は Prisma のモックが要り、
 * IT の方針（DB はモックしない）に反するため扱わない。
 */
const URL = 'http://localhost/api/conversations/search';

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * 検索 API を呼ぶ。
 *
 * @param params - クエリパラメータ
 * @returns 応答
 */
function search(params: Record<string, string>) {
  return GET(new NextRequest(`${URL}?${new URLSearchParams(params)}`));
}

/**
 * 検索して、成功した応答の本文を返す。
 *
 * @param params - クエリパラメータ
 * @returns 検索結果と続きの有無
 */
async function searchOk(params: Record<string, string>): Promise<{
  results: ConversationSearchResult[];
  hasMore: boolean;
}> {
  const res = await search(params);
  expect(res.status).toBe(200);
  return res.json();
}

/**
 * メッセージ付きの会話を作る。
 *
 * @param title - 会話のタイトル
 * @param contents - メッセージの本文（user・assistant の順に交互に作る）
 * @param updatedAt - 更新日時（並び順の検証用）。省略時は作成時刻
 * @returns 作った会話
 */
async function seed(title: string, contents: string[] = [], updatedAt?: Date) {
  const conversation = await prisma.conversation.create({
    data: { title, ...(updatedAt && { updatedAt }) },
  });
  for (const [i, content] of contents.entries()) {
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content,
        // 作成順を確定させる（抜粋に「最初に一致したメッセージ」を使うため）
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
      },
    });
  }
  // メッセージの追加で更新日時が変わらないよう、指定があれば最後に戻す
  if (updatedAt) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt },
    });
  }
  return conversation;
}

describe('GET /api/conversations/search', () => {
  describe('正常系', () => {
    it('タイトルに一致した会話を返し、本文に一致が無ければ抜粋は null にする', async () => {
      const conv = await seed('Java の勉強', ['こんにちは', 'どうも']);

      const { results, hasMore } = await searchOk({ q: 'Java' });

      expect(results).toEqual([
        {
          id: conv.id,
          title: 'Java の勉強',
          updatedAt: expect.any(String),
          snippet: null,
        },
      ]);
      expect(hasMore).toBe(false);
    });

    it('応答の本文に一致した会話を、一致箇所の抜粋付きで返す', async () => {
      await seed('雑談', ['最新版は？', '最新の LTS は Java 25 です。']);

      const { results } = await searchOk({ q: 'java' });

      expect(results).toHaveLength(1);
      expect(results[0].snippet).toBe('最新の LTS は Java 25 です。');
    });

    it('大文字・小文字を区別しない', async () => {
      await seed('雑談', ['TypeScript の型']);

      const { results } = await searchOk({ q: 'typescript' });

      expect(results).toHaveLength(1);
    });

    it('空白で区切った語をすべて含む会話だけを返す（語はタイトルと本文に分かれていてよい）', async () => {
      const both = await seed('React の相談', ['フックの使い方']);
      await seed('React の相談 2', ['コンポーネントの分け方']);
      await seed('Vue の相談', ['フックに相当するもの']);

      const { results } = await searchOk({ q: 'react フック' });

      expect(results.map((r) => r.id)).toEqual([both.id]);
    });

    it('更新日時の新しい順に返す', async () => {
      const old = await seed('Java 1', [], new Date('2026-01-01'));
      const recent = await seed('Java 2', [], new Date('2026-03-01'));
      const middle = await seed('Java 3', [], new Date('2026-02-01'));

      const { results } = await searchOk({ q: 'Java' });

      expect(results.map((r) => r.id)).toEqual([recent.id, middle.id, old.id]);
    });
  });

  describe('準正常系', () => {
    it('一致する会話が無ければ空の結果を返す', async () => {
      await seed('雑談', ['こんにちは']);

      expect(await searchOk({ q: '存在しない語' })).toEqual({
        results: [],
        hasMore: false,
      });
    });

    it('% と _ はワイルドカードではなく文字として扱う', async () => {
      const percent = await seed('雑談', ['性能が 10% 向上']);
      const underscore = await seed('雑談 2', ['変数名は user_id']);
      await seed('雑談 3', ['関係のない本文']);

      expect((await searchOk({ q: '%' })).results.map((r) => r.id)).toEqual([
        percent.id,
      ]);
      expect((await searchOk({ q: '_' })).results.map((r) => r.id)).toEqual([
        underscore.id,
      ]);
    });

    it('20 件ずつ返し、offset で続きを返す（重複・抜けが無い）', async () => {
      for (let i = 0; i < 25; i++) {
        await seed(`Java ${i}`, [], new Date(Date.UTC(2026, 0, 1, 0, 0, i)));
      }

      const first = await searchOk({ q: 'Java' });
      const second = await searchOk({ q: 'Java', offset: '20' });

      expect(first.results).toHaveLength(20);
      expect(first.hasMore).toBe(true);
      expect(second.results).toHaveLength(5);
      expect(second.hasMore).toBe(false);
      const ids = [...first.results, ...second.results].map((r) => r.id);
      expect(new Set(ids).size).toBe(25);
    });

    it('抜粋には、キーワードを含む最初のメッセージを使う', async () => {
      await seed('雑談', ['前置き', '1 つ目の Java', '2 つ目の Java']);

      const { results } = await searchOk({ q: 'java' });

      expect(results[0].snippet).toBe('1 つ目の Java');
    });

    it('思考過程・ツールの結果（metadata）だけに含まれる語では一致しない', async () => {
      const conv = await seed('雑談', ['質問']);
      await prisma.message.create({
        data: {
          conversationId: conv.id,
          role: 'assistant',
          content: '回答',
          metadata: { thinkingText: '内部の検討メモ' },
        },
      });

      expect((await searchOk({ q: '検討メモ' })).results).toEqual([]);
    });
  });

  describe('異常系', () => {
    it.each([
      ['q が無い', {}, 'キーワードを入力してください'],
      ['空白だけ', { q: '   ' }, 'キーワードを入力してください'],
      [
        '長すぎる',
        { q: 'あ'.repeat(MAX_SEARCH_QUERY_LENGTH + 1) },
        `キーワードは ${MAX_SEARCH_QUERY_LENGTH} 文字以内で入力してください`,
      ],
      [
        '語が多すぎる',
        {
          q: Array.from(
            { length: MAX_SEARCH_TERMS + 1 },
            (_, i) => `語${i}`
          ).join(' '),
        },
        `キーワードは ${MAX_SEARCH_TERMS} 語までにしてください`,
      ],
      [
        'offset が負',
        { q: 'Java', offset: '-1' },
        'offset は 0 以上の整数で指定してください',
      ],
    ])(
      '不正なクエリ（%s）は DB を見ずに 400 を返す',
      async (_label, params, error) => {
        const res = await search(params);

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error });
      }
    );
  });
});
