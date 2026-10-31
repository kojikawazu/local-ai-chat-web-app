import { describe, it, expect } from 'vitest';
import type { ChatState, ChatStates } from '@/lib/chat/chat-state';
import { EMPTY_CHAT, applyMessageBookmark } from '@/lib/chat/chat-state';
import { buildBookmarkSnippet } from '@/lib/bookmark/snippet';
import { parseSearchQuery } from '@/lib/conversation/search';
import {
  parseBookmarkNoteBody,
  parseCreateBookmarkBody,
} from '@/lib/server/request-body';
import { MAX_BOOKMARK_NOTE_LENGTH } from '@/lib/shared/validation';
import type { Message } from '@/types/chat/message';

/**
 * 応答のブックマーク（#30）の純ロジックの UT。外部 I/O が無いため mock は使わない。
 * 対象: 一覧の抜粋（`lib/bookmark/snippet.ts`）・一覧のクエリ（`parseSearchQuery` の `allowEmpty`）・
 * ボディの検証（`parseCreateBookmarkBody`・`parseBookmarkNoteBody`）・表示への反映（`applyMessageBookmark`）。
 */

const MESSAGE_ID = '11111111-1111-4111-8111-111111111111';

/**
 * 応答のメッセージを作る。
 *
 * @param id - メッセージ ID
 * @param bookmarkId - 付いているブックマークの ID（省略時は付いていない）
 * @returns メッセージ
 */
const answer = (id: string, bookmarkId?: string): Message => ({
  id,
  role: 'assistant',
  content: id,
  createdAt: new Date(0),
  ...(bookmarkId && { bookmarkId }),
});

/**
 * メッセージを持つ会話の状態を作る。
 *
 * @param messages - 会話のメッセージ
 * @returns 会話の状態
 */
const chat = (messages: Message[]): ChatState => ({ ...EMPTY_CHAT, messages });

describe('buildBookmarkSnippet', () => {
  describe('正常系', () => {
    it('キーワードが本文にあれば、その前後を切り出す', () => {
      const content = `${'あ'.repeat(60)}Docker の手順${'い'.repeat(60)}`;
      const snippet = buildBookmarkSnippet(content, ['docker']);
      expect(snippet).toMatch(/^…あ+Docker の手順い+…$/);
    });

    it('キーワードが無ければ先頭を出し、改行・連続する空白を 1 つにまとめる', () => {
      expect(buildBookmarkSnippet('一行目\n\n  二行目', [])).toBe(
        '一行目 二行目'
      );
    });

    it('120 文字を超える本文は 120 文字で切り、… を付ける', () => {
      const snippet = buildBookmarkSnippet('あ'.repeat(200), []);
      expect(snippet).toBe(`${'あ'.repeat(120)}…`);
    });

    it('120 文字ちょうどなら … を付けない', () => {
      expect(buildBookmarkSnippet('あ'.repeat(120), [])).toBe('あ'.repeat(120));
    });
  });

  describe('準正常系', () => {
    it('キーワードが本文に無ければ（メモ・タイトルだけに一致）、先頭を出す', () => {
      expect(buildBookmarkSnippet('本文', ['メモの語'])).toBe('本文');
    });

    it('絵文字（サロゲートペア）を途中で切らない', () => {
      const snippet = buildBookmarkSnippet('😀'.repeat(130), []);
      expect(snippet).toBe(`${'😀'.repeat(120)}…`);
    });
  });

  describe('異常系', () => {
    it('空白だけの本文は空文字列', () => {
      expect(buildBookmarkSnippet(' \n\t ', [])).toBe('');
    });
  });
});

describe('parseSearchQuery（allowEmpty。ブックマークの一覧）', () => {
  describe('正常系', () => {
    it('空の q は「絞り込まない」として受け付ける', () => {
      expect(
        parseSearchQuery(new URLSearchParams(), { allowEmpty: true })
      ).toEqual({ ok: true, value: { terms: [], offset: 0 } });
      expect(
        parseSearchQuery(new URLSearchParams({ q: '  ', offset: '20' }), {
          allowEmpty: true,
        })
      ).toEqual({ ok: true, value: { terms: [], offset: 20 } });
    });

    it('キーワードは会話の検索と同じく空白で分ける', () => {
      expect(
        parseSearchQuery(new URLSearchParams({ q: 'React　hooks' }), {
          allowEmpty: true,
        })
      ).toEqual({ ok: true, value: { terms: ['React', 'hooks'], offset: 0 } });
    });
  });

  describe('準正常系', () => {
    it('allowEmpty でなければ、空の q は今までどおり失敗（会話の検索）', () => {
      expect(parseSearchQuery(new URLSearchParams()).ok).toBe(false);
    });
  });

  describe('異常系', () => {
    it.each([
      ['長すぎる q', { q: 'あ'.repeat(101) }],
      ['語が多すぎる q', { q: 'a b c d e f' }],
      ['数字でない offset', { offset: '1e3' }],
    ])('%s は失敗', (_label, params) => {
      expect(
        parseSearchQuery(new URLSearchParams(params), { allowEmpty: true }).ok
      ).toBe(false);
    });
  });
});

describe('parseCreateBookmarkBody', () => {
  describe('正常系', () => {
    it('UUID の messageId を受け付ける', () => {
      expect(parseCreateBookmarkBody({ messageId: MESSAGE_ID })).toEqual({
        ok: true,
        value: { messageId: MESSAGE_ID },
      });
    });
  });

  describe('準正常系', () => {
    it('ほかのフィールドは捨てる', () => {
      expect(
        parseCreateBookmarkBody({ messageId: MESSAGE_ID, note: 'メモ' })
      ).toEqual({ ok: true, value: { messageId: MESSAGE_ID } });
    });
  });

  describe('異常系', () => {
    it.each([
      ['null', null],
      ['配列', [MESSAGE_ID]],
      ['messageId が無い', {}],
      ['messageId が数値', { messageId: 1 }],
      ['messageId が UUID でない', { messageId: 'not-a-uuid' }],
    ])('%s は失敗', (_label, body) => {
      expect(parseCreateBookmarkBody(body).ok).toBe(false);
    });
  });
});

describe('parseBookmarkNoteBody', () => {
  describe('正常系', () => {
    it('前後の空白を除いたメモを受け付ける（中の改行は残す）', () => {
      expect(parseBookmarkNoteBody({ note: '  一行目\n二行目  ' })).toEqual({
        ok: true,
        value: { note: '一行目\n二行目' },
      });
    });

    it('null はメモを消す', () => {
      expect(parseBookmarkNoteBody({ note: null })).toEqual({
        ok: true,
        value: { note: null },
      });
    });

    it(`${MAX_BOOKMARK_NOTE_LENGTH} 文字まで受け付ける（前後の空白は数えない）`, () => {
      const note = 'あ'.repeat(MAX_BOOKMARK_NOTE_LENGTH);
      expect(parseBookmarkNoteBody({ note: ` ${note} ` })).toEqual({
        ok: true,
        value: { note },
      });
    });
  });

  describe('準正常系', () => {
    it('空白だけのメモは null（メモなし）にする', () => {
      expect(parseBookmarkNoteBody({ note: ' \n ' })).toEqual({
        ok: true,
        value: { note: null },
      });
    });
  });

  describe('異常系', () => {
    it.each([
      ['null のボディ', null],
      ['配列', ['メモ']],
      ['note が無い', {}],
      ['note が数値', { note: 1 }],
      ['上限を超えるメモ', { note: 'あ'.repeat(MAX_BOOKMARK_NOTE_LENGTH + 1) }],
    ])('%s は失敗', (_label, body) => {
      expect(parseBookmarkNoteBody(body).ok).toBe(false);
    });
  });
});

describe('applyMessageBookmark', () => {
  describe('正常系', () => {
    it('そのメッセージを持つ会話だけを更新し、ブックマークの ID を付ける', () => {
      const chats: ChatStates = {
        a: chat([answer('m1'), answer('m2')]),
        b: chat([answer('m3')]),
      };
      const next = applyMessageBookmark(chats, 'm2', 'b1');
      expect(next.a.messages.map((m) => m.bookmarkId)).toEqual([
        undefined,
        'b1',
      ]);
      // 関係の無い会話は同じオブジェクトのまま（描画し直さない）
      expect(next.b).toBe(chats.b);
    });

    it('外したときは bookmarkId をプロパティごと消す（DB から読んだ形と揃える）', () => {
      const chats: ChatStates = { a: chat([answer('m1', 'b1')]) };
      const next = applyMessageBookmark(chats, 'm1', null);
      expect('bookmarkId' in next.a.messages[0]).toBe(false);
    });
  });

  describe('準正常系', () => {
    it('どの会話にもそのメッセージが無ければ、状態をそのまま返す（会話の状態を作らない）', () => {
      const chats: ChatStates = { a: chat([answer('m1')]) };
      const next = applyMessageBookmark(chats, 'other', 'b1');
      expect(next).toBe(chats);
      expect(Object.keys(next)).toEqual(['a']);
    });
  });

  describe('異常系', () => {
    it('会話が 1 つも無くても失敗しない', () => {
      expect(applyMessageBookmark({}, 'm1', 'b1')).toEqual({});
    });
  });
});
