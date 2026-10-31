import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/bookmarks/route';
import { PATCH, DELETE } from '@/app/api/bookmarks/[id]/route';
import { GET as GET_MESSAGES } from '@/app/api/conversations/[id]/messages/route';
import { PUT as PUT_MESSAGE } from '@/app/api/conversations/[id]/messages/[messageId]/route';
import { DELETE as DELETE_CONVERSATION } from '@/app/api/conversations/[id]/route';
import { prisma, resetDb, jsonRequest, routeContext } from './helpers/db';
import { MAX_BOOKMARK_NOTE_LENGTH } from '@/lib/shared/validation';

/**
 * `/api/bookmarks`（応答のブックマーク。#30）の IT。
 * 付ける・一覧（並び・ページ・検索）・メモの書き換え・外す・409・404・400 と、
 * メッセージ一覧の `bookmark`・再生成の置き換えと会話の削除でブックマークが消えることを実 DB に対して検証する。
 */
const URL = 'http://localhost/api/bookmarks';
const NONEXISTENT = '00000000-0000-0000-0000-000000000000';
/** UUID 形式でない ID。`id` 列は TEXT なので Prisma は例外を投げず、検証が無いと 404 に化ける。 */
const NOT_UUID = 'not-a-uuid';

/** 一覧の 1 件のうち、テストで見る項目 */
type ListedBookmark = {
  id: string;
  note: string | null;
  messageId: string;
  conversationId: string;
  conversationTitle: string;
  snippet: string;
};

/**
 * 会話と、質問・応答の 2 件のメッセージを DB に直接作る。
 *
 * @param title - 会話のタイトル
 * @param answer - 応答の本文
 * @returns 会話・質問・応答の ID
 */
async function createExchange(title: string, answer: string) {
  const conversation = await prisma.conversation.create({ data: { title } });
  const question = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: 'user',
      content: `${title}の質問`,
    },
  });
  const reply = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: 'assistant',
      content: answer,
    },
  });
  return {
    conversationId: conversation.id,
    questionId: question.id,
    answerId: reply.id,
  };
}

/**
 * ブックマークを DB に直接作る。並びを確かめるため、付けた日時を指定できる。
 *
 * @param messageId - 応答の ID
 * @param options - メモと付けた日時（省略時はメモなし・今）
 * @returns 作ったブックマーク
 */
async function createBookmark(
  messageId: string,
  options: { note?: string; createdAt?: Date } = {}
) {
  return prisma.bookmark.create({
    data: {
      messageId,
      note: options.note ?? null,
      createdAt: options.createdAt,
    },
  });
}

/**
 * 一覧の API を呼ぶ。
 *
 * @param params - クエリパラメータ（`q`・`offset`）
 * @returns 応答
 */
function list(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params);
  return GET(new NextRequest(`${URL}?${query}`));
}

/**
 * 一覧の API を呼び、200 であることを確かめて中身を返す。
 *
 * @param params - クエリパラメータ（`q`・`offset`）
 * @returns 一覧と続きの有無
 */
async function listOk(params: Record<string, string> = {}) {
  const res = await list(params);
  expect(res.status).toBe(200);
  return (await res.json()) as {
    bookmarks: ListedBookmark[];
    hasMore: boolean;
  };
}

/**
 * 指定したテーブルの、指定した操作だけを実 DB 側で失敗させて `run` を実行する（Prisma をモックしない障害注入）。
 *
 * @param operation - 失敗させる操作（`INSERT` / `UPDATE` / `DELETE`）
 * @param run - 失敗させている間に行う処理
 */
async function withFailingBookmarks(
  operation: 'INSERT' | 'UPDATE' | 'DELETE',
  run: () => Promise<void>
) {
  await prisma.$executeRaw`
    CREATE FUNCTION fail_bookmark() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'injected failure';
    END;
    $$ LANGUAGE plpgsql`;
  // 操作の種類は SQL の識別子の位置でパラメータにできないため、文字列を組み立てずに操作ごとの固定の文を書く
  if (operation === 'INSERT') {
    await prisma.$executeRaw`CREATE TRIGGER fail_bookmark BEFORE INSERT ON "Bookmark" FOR EACH ROW EXECUTE FUNCTION fail_bookmark()`;
  } else if (operation === 'UPDATE') {
    await prisma.$executeRaw`CREATE TRIGGER fail_bookmark BEFORE UPDATE ON "Bookmark" FOR EACH ROW EXECUTE FUNCTION fail_bookmark()`;
  } else {
    await prisma.$executeRaw`CREATE TRIGGER fail_bookmark BEFORE DELETE ON "Bookmark" FOR EACH ROW EXECUTE FUNCTION fail_bookmark()`;
  }
  try {
    await run();
  } finally {
    await prisma.$executeRaw`DROP TRIGGER fail_bookmark ON "Bookmark"`;
    await prisma.$executeRaw`DROP FUNCTION fail_bookmark()`;
  }
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /api/bookmarks', () => {
  describe('正常系', () => {
    it('応答に付けて 201 を返す（メモは付けない）', async () => {
      const { answerId } = await createExchange('会話', '応答');

      const res = await POST(jsonRequest(URL, 'POST', { messageId: answerId }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toMatchObject({ messageId: answerId, note: null });
      expect(
        await prisma.bookmark.count({ where: { messageId: answerId } })
      ).toBe(1);
    });
  });

  describe('準正常系', () => {
    it('もう付いている応答は 409 で、2 つ目を作らない', async () => {
      const { answerId } = await createExchange('会話', '応答');
      await createBookmark(answerId);

      const res = await POST(jsonRequest(URL, 'POST', { messageId: answerId }));
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: 'この応答はもうブックマークしています',
      });
      expect(await prisma.bookmark.count()).toBe(1);
    });

    it('user のメッセージは 400 で、作らない', async () => {
      const { questionId } = await createExchange('会話', '応答');

      const res = await POST(
        jsonRequest(URL, 'POST', { messageId: questionId })
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'ブックマークできるのは応答だけです',
      });
      expect(await prisma.bookmark.count()).toBe(0);
    });

    it('存在しないメッセージは 404', async () => {
      const res = await POST(
        jsonRequest(URL, 'POST', { messageId: NONEXISTENT })
      );
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'メッセージが見つかりません' });
    });
    it('読んでから作る間にメッセージが消されたら（外部キーの違反）404 で、作らない', async () => {
      const { answerId } = await createExchange('会話', '応答');
      // 作る直前に参照先を消すトリガーで、確認と作成の間に会話が消された状態を DB 側で起こす
      await prisma.$executeRaw`
        CREATE FUNCTION delete_message_before_bookmark() RETURNS trigger AS $$
        BEGIN
          DELETE FROM "Message" WHERE id = NEW."messageId";
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql`;
      await prisma.$executeRaw`CREATE TRIGGER delete_message_before_bookmark BEFORE INSERT ON "Bookmark" FOR EACH ROW EXECUTE FUNCTION delete_message_before_bookmark()`;
      try {
        const res = await POST(
          jsonRequest(URL, 'POST', { messageId: answerId })
        );
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({
          error: 'メッセージが見つかりません',
        });
      } finally {
        await prisma.$executeRaw`DROP TRIGGER delete_message_before_bookmark ON "Bookmark"`;
        await prisma.$executeRaw`DROP FUNCTION delete_message_before_bookmark()`;
      }
      expect(await prisma.bookmark.count()).toBe(0);
    });
  });

  describe('異常系', () => {
    it.each([
      ['UUID でない messageId', { messageId: NOT_UUID }],
      ['messageId が無い', {}],
      ['messageId が数値', { messageId: 1 }],
      ['配列', [NONEXISTENT]],
      ['null', null],
    ])('%s は DB に触れずに 400', async (_label, body) => {
      const res = await POST(jsonRequest(URL, 'POST', body));
      expect(res.status).toBe(400);
      expect(await res.json()).toHaveProperty('error');
    });

    it('JSON として不正なボディは 400', async () => {
      const res = await POST(jsonRequest(URL, 'POST', '{bad'));
      expect(res.status).toBe(400);
    });

    it('DB 側で作成に失敗すると 500 で、作らない', async () => {
      const { answerId } = await createExchange('会話', '応答');
      await withFailingBookmarks('INSERT', async () => {
        const res = await POST(
          jsonRequest(URL, 'POST', { messageId: answerId })
        );
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({
          error: 'ブックマークに失敗しました',
        });
      });
      expect(await prisma.bookmark.count()).toBe(0);
    });
  });
});

describe('GET /api/bookmarks', () => {
  describe('正常系', () => {
    it('付けた日時の新しい順に、会話・応答の情報と抜粋を付けて返す', async () => {
      const older = await createExchange('古い会話', '古い応答');
      const newer = await createExchange('新しい会話', '新しい応答');
      await createBookmark(older.answerId, {
        note: 'メモ',
        createdAt: new Date('2026-10-01T00:00:00Z'),
      });
      await createBookmark(newer.answerId, {
        createdAt: new Date('2026-10-02T00:00:00Z'),
      });

      const { bookmarks, hasMore } = await listOk();
      expect(hasMore).toBe(false);
      expect(bookmarks).toEqual([
        expect.objectContaining({
          note: null,
          messageId: newer.answerId,
          conversationId: newer.conversationId,
          conversationTitle: '新しい会話',
          snippet: '新しい応答',
        }),
        expect.objectContaining({
          note: 'メモ',
          messageId: older.answerId,
          conversationTitle: '古い会話',
        }),
      ]);
    });

    it('20 件ずつ返し、offset で続きを返す（重複・抜けなし）', async () => {
      const base = Date.parse('2026-10-01T00:00:00Z');
      for (let i = 0; i < 25; i++) {
        const { answerId } = await createExchange(`会話${i}`, `応答${i}`);
        await createBookmark(answerId, {
          createdAt: new Date(base + i * 1000),
        });
      }

      const first = await listOk();
      expect(first.bookmarks).toHaveLength(20);
      expect(first.hasMore).toBe(true);
      expect(first.bookmarks[0].conversationTitle).toBe('会話24');

      const second = await listOk({ offset: '20' });
      expect(second.bookmarks).toHaveLength(5);
      expect(second.hasMore).toBe(false);
      const ids = [...first.bookmarks, ...second.bookmarks].map((b) => b.id);
      expect(new Set(ids).size).toBe(25);
    });

    it('キーワードはメモ・応答の本文・会話のタイトルのどれに一致しても返す', async () => {
      const byNote = await createExchange('会話A', '本文A');
      const byContent = await createExchange('会話B', 'Docker の手順');
      const byTitle = await createExchange('docker の質問', '本文C');
      const unrelated = await createExchange('会話D', '本文D');
      await createBookmark(byNote.answerId, { note: 'DOCKER のメモ' });
      await createBookmark(byContent.answerId);
      await createBookmark(byTitle.answerId);
      await createBookmark(unrelated.answerId);

      const { bookmarks } = await listOk({ q: 'docker' });
      expect(bookmarks.map((b) => b.messageId).sort()).toEqual(
        [byNote.answerId, byContent.answerId, byTitle.answerId].sort()
      );
    });

    it('語のすべてを含むものだけを返し（AND）、本文に一致した箇所を抜粋にする', async () => {
      const both = await createExchange(
        'React の会話',
        `${'前置き。'.repeat(30)}フォームの検証は useActionState で書く`
      );
      const one = await createExchange(
        'React の別の会話',
        'フォームとは無関係'
      );
      await createBookmark(both.answerId);
      await createBookmark(one.answerId, { note: 'メモ' });

      const { bookmarks } = await listOk({ q: 'React useActionState' });
      expect(bookmarks).toHaveLength(1);
      expect(bookmarks[0].messageId).toBe(both.answerId);
      expect(bookmarks[0].snippet).toMatch(/^….*useActionState/);
    });

    it('ブックマークが無ければ空', async () => {
      await createExchange('会話', '応答');
      expect(await listOk()).toEqual({ bookmarks: [], hasMore: false });
    });
  });

  describe('準正常系', () => {
    it('% と _ は文字そのものとして扱う', async () => {
      const percent = await createExchange('会話1', '進捗 100% 完了');
      const plain = await createExchange('会話2', '進捗 100 件');
      await createBookmark(percent.answerId);
      await createBookmark(plain.answerId);

      const { bookmarks } = await listOk({ q: '100%' });
      expect(bookmarks.map((b) => b.messageId)).toEqual([percent.answerId]);
      expect((await listOk({ q: '_' })).bookmarks).toEqual([]);
    });

    it('一致しなければ空', async () => {
      const { answerId } = await createExchange('会話', '応答');
      await createBookmark(answerId);
      expect((await listOk({ q: '存在しない語' })).bookmarks).toEqual([]);
    });
  });

  describe('異常系', () => {
    it.each([
      ['長すぎるキーワード', { q: 'あ'.repeat(101) }],
      ['語が多すぎる', { q: 'a b c d e f' }],
      ['負の offset', { offset: '-1' }],
      ['数字でない offset', { offset: 'abc' }],
    ])('%s は 400', async (_label, params) => {
      const res = await list(params);
      expect(res.status).toBe(400);
      expect(await res.json()).toHaveProperty('error');
    });
  });
});

describe('PATCH・DELETE /api/bookmarks/[id]', () => {
  describe('正常系', () => {
    it('メモを書き換え（前後の空白を除く）、null で消す', async () => {
      const { answerId } = await createExchange('会話', '応答');
      const bookmark = await createBookmark(answerId);

      const res = await PATCH(
        jsonRequest(URL, 'PATCH', { note: '  読み返す  ' }),
        routeContext(bookmark.id)
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        id: bookmark.id,
        note: '読み返す',
      });

      const cleared = await PATCH(
        jsonRequest(URL, 'PATCH', { note: null }),
        routeContext(bookmark.id)
      );
      expect(cleared.status).toBe(200);
      expect(
        (await prisma.bookmark.findUnique({ where: { id: bookmark.id } }))?.note
      ).toBeNull();
    });

    it('空白だけのメモはメモなし（null）にする', async () => {
      const { answerId } = await createExchange('会話', '応答');
      const bookmark = await createBookmark(answerId, { note: 'メモ' });

      const res = await PATCH(
        jsonRequest(URL, 'PATCH', { note: ' \n ' }),
        routeContext(bookmark.id)
      );
      expect(res.status).toBe(200);
      expect((await res.json()).note).toBeNull();
    });

    it('外すと 200 で、応答は残る', async () => {
      const { answerId } = await createExchange('会話', '応答');
      const bookmark = await createBookmark(answerId);

      const res = await DELETE(
        jsonRequest(URL, 'DELETE'),
        routeContext(bookmark.id)
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(await prisma.bookmark.count()).toBe(0);
      expect(await prisma.message.count({ where: { id: answerId } })).toBe(1);
    });
  });

  describe('準正常系', () => {
    it('存在しないブックマークの書き換え・外すは 404', async () => {
      const patched = await PATCH(
        jsonRequest(URL, 'PATCH', { note: 'メモ' }),
        routeContext(NONEXISTENT)
      );
      expect(patched.status).toBe(404);
      expect(await patched.json()).toEqual({
        error: 'ブックマークが見つかりません',
      });

      const deleted = await DELETE(
        jsonRequest(URL, 'DELETE'),
        routeContext(NONEXISTENT)
      );
      expect(deleted.status).toBe(404);
    });

    it(`${MAX_BOOKMARK_NOTE_LENGTH} 文字を超えるメモは 400 で、変えない`, async () => {
      const { answerId } = await createExchange('会話', '応答');
      const bookmark = await createBookmark(answerId, { note: '元のメモ' });

      const res = await PATCH(
        jsonRequest(URL, 'PATCH', {
          note: 'あ'.repeat(MAX_BOOKMARK_NOTE_LENGTH + 1),
        }),
        routeContext(bookmark.id)
      );
      expect(res.status).toBe(400);
      expect(
        (await prisma.bookmark.findUnique({ where: { id: bookmark.id } }))?.note
      ).toBe('元のメモ');
    });

    it(`${MAX_BOOKMARK_NOTE_LENGTH} 文字のメモは保存できる`, async () => {
      const { answerId } = await createExchange('会話', '応答');
      const bookmark = await createBookmark(answerId);
      const note = 'あ'.repeat(MAX_BOOKMARK_NOTE_LENGTH);

      const res = await PATCH(
        jsonRequest(URL, 'PATCH', { note }),
        routeContext(bookmark.id)
      );
      expect(res.status).toBe(200);
      expect((await res.json()).note).toBe(note);
    });
  });

  describe('異常系', () => {
    it('ID が UUID でなければ 400', async () => {
      const patched = await PATCH(
        jsonRequest(URL, 'PATCH', { note: 'メモ' }),
        routeContext(NOT_UUID)
      );
      expect(patched.status).toBe(400);
      const deleted = await DELETE(
        jsonRequest(URL, 'DELETE'),
        routeContext(NOT_UUID)
      );
      expect(deleted.status).toBe(400);
      expect(await deleted.json()).toEqual({
        error: '無効なブックマークIDです',
      });
    });

    it.each([
      ['note が無い', {}],
      ['note が数値', { note: 1 }],
      ['配列', ['メモ']],
    ])('ボディが不正（%s）なら 400 で、変えない', async (_label, body) => {
      const { answerId } = await createExchange('会話', '応答');
      const bookmark = await createBookmark(answerId, { note: '元のメモ' });

      const res = await PATCH(
        jsonRequest(URL, 'PATCH', body),
        routeContext(bookmark.id)
      );
      expect(res.status).toBe(400);
      expect(
        (await prisma.bookmark.findUnique({ where: { id: bookmark.id } }))?.note
      ).toBe('元のメモ');
    });

    it('DB 側で書き換え・外すのに失敗すると 500 で、変えない', async () => {
      const { answerId } = await createExchange('会話', '応答');
      const bookmark = await createBookmark(answerId, { note: '元のメモ' });

      await withFailingBookmarks('UPDATE', async () => {
        const res = await PATCH(
          jsonRequest(URL, 'PATCH', { note: '新しいメモ' }),
          routeContext(bookmark.id)
        );
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: 'メモの保存に失敗しました' });
      });
      await withFailingBookmarks('DELETE', async () => {
        const res = await DELETE(
          jsonRequest(URL, 'DELETE'),
          routeContext(bookmark.id)
        );
        expect(res.status).toBe(500);
      });
      expect(
        (await prisma.bookmark.findUnique({ where: { id: bookmark.id } }))?.note
      ).toBe('元のメモ');
    });
  });
});

describe('メッセージ・会話とのつながり', () => {
  describe('正常系', () => {
    it('メッセージ一覧の各メッセージに、付いているブックマークの ID を付ける', async () => {
      const { conversationId, questionId, answerId } = await createExchange(
        '会話',
        '応答'
      );
      const bookmark = await createBookmark(answerId);

      const res = await GET_MESSAGES(
        jsonRequest(
          `http://localhost/api/conversations/${conversationId}/messages`,
          'GET'
        ),
        routeContext(conversationId)
      );
      expect(res.status).toBe(200);
      const { messages } = await res.json();
      const byId = new Map(
        messages.map((m: { id: string; bookmark: unknown }) => [
          m.id,
          m.bookmark,
        ])
      );
      expect(byId.get(questionId)).toBeNull();
      expect(byId.get(answerId)).toEqual({ id: bookmark.id });
    });

    it('会話を消すと、その応答のブックマークも消える', async () => {
      const { conversationId, answerId } = await createExchange('会話', '応答');
      const other = await createExchange('別の会話', '別の応答');
      await createBookmark(answerId);
      await createBookmark(other.answerId);

      const res = await DELETE_CONVERSATION(
        jsonRequest(
          `http://localhost/api/conversations/${conversationId}`,
          'DELETE'
        ),
        routeContext(conversationId)
      );
      expect(res.status).toBe(200);
      const remaining = await prisma.bookmark.findMany();
      expect(remaining.map((b) => b.messageId)).toEqual([other.answerId]);
    });
  });

  describe('準正常系', () => {
    it('再生成で応答を置き換えると、その応答のブックマークは消える（他の応答のものは残る）', async () => {
      const { conversationId, answerId } = await createExchange(
        '会話',
        '前の応答'
      );
      const other = await createExchange('別の会話', '別の応答');
      await createBookmark(answerId, { note: 'メモ' });
      await createBookmark(other.answerId);

      const res = await PUT_MESSAGE(
        jsonRequest('http://localhost/api/conversations/x/messages/y', 'PUT', {
          content: '新しい応答',
        }),
        { params: Promise.resolve({ id: conversationId, messageId: answerId }) }
      );
      expect(res.status).toBe(200);
      expect(
        await prisma.bookmark.count({ where: { messageId: answerId } })
      ).toBe(0);
      expect(
        await prisma.bookmark.count({ where: { messageId: other.answerId } })
      ).toBe(1);
    });
  });

  describe('異常系', () => {
    it('置き換えに失敗した（応答が無い）ときは、ブックマークを消さない', async () => {
      const { conversationId, answerId } = await createExchange('会話', '応答');
      await createBookmark(answerId);
      const other = await createExchange('別の会話', '別の応答');

      // 別の会話の ID を指定すると、この会話の応答として見つからず 404 になる（何も書き換えない）
      const res = await PUT_MESSAGE(
        jsonRequest('http://localhost/api/conversations/x/messages/y', 'PUT', {
          content: '新しい応答',
        }),
        {
          params: Promise.resolve({
            id: other.conversationId,
            messageId: answerId,
          }),
        }
      );
      expect(res.status).toBe(404);
      expect(conversationId).not.toBe(other.conversationId);
      expect(
        await prisma.bookmark.count({ where: { messageId: answerId } })
      ).toBe(1);
    });
  });
});
