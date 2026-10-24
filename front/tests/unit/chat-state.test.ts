import { describe, it, expect } from 'vitest';
import type { ChatState, ChatStates } from '@/lib/chat/chat-state';
import {
  EMPTY_CHAT,
  NEW_CONVERSATION_KEY,
  applyLoadedMessages,
  chatKey,
  generatingConversationIds,
  getChat,
  moveChat,
  removeChat,
  retainChats,
  updateChat,
} from '@/lib/chat/chat-state';
import type { Message } from '@/types/chat/message';

/**
 * 会話ごとのチャット状態（`lib/chat/chat-state.ts`）の UT。状態を受け取って新しい状態を返す純関数のため
 * mock は使わない。
 * 契約: 生成中に会話を切り替えても、送信した会話の状態（生成中の応答・保存失敗・エラー）が失われず、
 * DB から読み直せる会話の状態だけを捨てる（#147）。
 */

/**
 * メッセージを作る。
 *
 * @param id - メッセージ ID
 * @param saveState - 保存に失敗したときの状態。省略時は保存済み
 * @returns メッセージ
 */
const message = (id: string, saveState?: Message['saveState']): Message => ({
  id,
  role: 'user',
  content: id,
  createdAt: new Date(0),
  ...(saveState && { saveState }),
});

/**
 * 会話の状態を作る。
 *
 * @param patch - {@link EMPTY_CHAT} から変える項目
 * @returns 会話の状態
 */
const chat = (patch: Partial<ChatState> = {}): ChatState => ({
  ...EMPTY_CHAT,
  ...patch,
});

describe('chat-state', () => {
  describe('正常系', () => {
    it('会話 ID をそのままキーにし、会話を作る前は新規会話のキーにする', () => {
      expect(chatKey('conv-1')).toBe('conv-1');
      expect(chatKey(null)).toBe(NEW_CONVERSATION_KEY);
    });

    it('1 つの会話だけを更新し、他の会話の状態はそのまま残す', () => {
      const other = chat({ messages: [message('b1')] });
      const chats: ChatStates = { a: chat(), b: other };

      const updated = updateChat(chats, 'a', (c) => ({
        ...c,
        isLoading: true,
      }));

      expect(updated.a.isLoading).toBe(true);
      expect(updated.b).toBe(other);
    });

    it('新規会話の画面の送信中の状態を、作った会話へ移す', () => {
      const sending = chat({ isLoading: true });

      const moved = moveChat(
        { [NEW_CONVERSATION_KEY]: sending },
        NEW_CONVERSATION_KEY,
        'created'
      );

      expect(moved).toEqual({ created: sending });
    });

    it('表示中の会話と、生成中・保存失敗・エラーを持つ会話だけを残し、他は捨てる', () => {
      const chats: ChatStates = {
        current: chat({ messages: [message('c1')] }),
        generating: chat({ isLoading: true }),
        unsaved: chat({ messages: [message('u1', 'failed')] }),
        failed: chat({ error: '生成に失敗しました' }),
        idle: chat({ messages: [message('i1')] }),
      };

      expect(Object.keys(retainChats(chats, 'current')).sort()).toEqual(
        ['current', 'failed', 'generating', 'unsaved'].sort()
      );
    });

    it('DB から読んだメッセージを反映し、エラーは残す', () => {
      const chats: ChatStates = { a: chat({ error: '生成に失敗しました' }) };
      const loaded = [message('a1'), message('a2')];

      const applied = applyLoadedMessages(chats, 'a', loaded);

      expect(applied.a).toEqual(
        chat({ messages: loaded, error: '生成に失敗しました' })
      );
    });

    it('生成中の会話の ID だけを返す', () => {
      const chats: ChatStates = {
        a: chat({ isLoading: true }),
        b: chat(),
        c: chat({ isLoading: true }),
      };

      expect(generatingConversationIds(chats).sort()).toEqual(['a', 'c']);
    });
  });

  describe('準正常系', () => {
    it('状態を持たない会話は空の状態として扱う', () => {
      expect(getChat({}, 'unknown')).toBe(EMPTY_CHAT);
      expect(updateChat({}, 'a', (c) => c)).toEqual({ a: EMPTY_CHAT });
    });

    it('生成中の会話には DB の内容を反映しない（生成中の応答を消さない）', () => {
      const chats: ChatStates = {
        a: chat({ isLoading: true, messages: [message('q'), message('ans')] }),
      };

      expect(applyLoadedMessages(chats, 'a', [message('q')])).toBe(chats);
    });

    it('保存に失敗したメッセージがある会話には DB の内容を反映しない（再試行を残す）', () => {
      const chats: ChatStates = {
        a: chat({ messages: [message('a1'), message('a2', 'retrying')] }),
      };

      expect(applyLoadedMessages(chats, 'a', [message('a1')])).toBe(chats);
    });

    it('状態を持たない会話を移すと、移した先は空の状態になる', () => {
      expect(moveChat({}, NEW_CONVERSATION_KEY, 'created')).toEqual({
        created: EMPTY_CHAT,
      });
    });

    it('新規会話の画面が送信中でも、生成中の会話の一覧には含めない（会話がまだ無い）', () => {
      const chats: ChatStates = {
        [NEW_CONVERSATION_KEY]: chat({ isLoading: true }),
      };

      expect(generatingConversationIds(chats)).toEqual([]);
    });
  });

  describe('異常系', () => {
    it('削除した会話の状態を捨てる（生成中でも残さない）', () => {
      const chats: ChatStates = {
        deleted: chat({ isLoading: true, error: '生成に失敗しました' }),
        other: chat(),
      };

      expect(removeChat(chats, 'deleted')).toEqual({ other: chat() });
    });

    it('状態を持たない会話を捨てても、他の会話は変わらない', () => {
      const chats: ChatStates = { a: chat({ isLoading: true }) };

      expect(removeChat(chats, 'unknown')).toEqual(chats);
    });

    it('表示中の会話は、状態が空でも捨てない', () => {
      expect(retainChats({ current: EMPTY_CHAT }, 'current')).toEqual({
        current: EMPTY_CHAT,
      });
    });
  });
});
