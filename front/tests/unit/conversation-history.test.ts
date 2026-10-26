import { describe, it, expect } from 'vitest';
import { toConversationHistory } from '@/lib/chat/conversation-history';
import {
  MAX_ASSISTANT_MESSAGE_LENGTH,
  MAX_HISTORY_MESSAGES,
  MAX_MESSAGE_LENGTH,
} from '@/lib/shared/validation';
import type { Message } from '@/types/chat/message';

/**
 * `lib/chat/conversation-history` の UT。
 * `/api/chat` の履歴検証（#95）に合わせ、画面上のメッセージから組み立てた履歴が
 * サーバーの上限（件数・role 別の本文長）を超えないことを確かめる。純関数のため mock は使わない。
 */

/**
 * テスト用のメッセージを組み立てる。
 *
 * @param role - 発話者の役割
 * @param content - 本文
 * @param saveState - 保存に失敗した状態（省略時は保存済み）
 * @returns 表示中のメッセージ
 */
function msg(
  role: Message['role'],
  content: string,
  saveState?: Message['saveState']
): Message {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date(),
    saveState,
  };
}

describe('toConversationHistory', () => {
  describe('正常系', () => {
    it('role と content だけを古い順に返す', () => {
      expect(
        toConversationHistory([msg('user', '質問'), msg('assistant', '回答')])
      ).toEqual([
        { role: 'user', content: '質問' },
        { role: 'assistant', content: '回答' },
      ]);
    });
  });

  describe('準正常系', () => {
    it('添付画像のある user には imageIds を付け、無いメッセージには付けない（#6）', () => {
      const question: Message = {
        ...msg('user', 'これは？'),
        images: [
          { id: 'img-1', src: 'data:image/png;base64,AA', width: 1, height: 1 },
        ],
      };
      expect(
        toConversationHistory([question, msg('assistant', '猫です')])
      ).toEqual([
        { role: 'user', content: 'これは？', imageIds: ['img-1'] },
        { role: 'assistant', content: '猫です' },
      ]);
    });

    it('保存に失敗した user は除き、保存に失敗した assistant は含める', () => {
      expect(
        toConversationHistory([
          msg('user', '届いていない', 'failed'),
          msg('user', '質問'),
          msg('assistant', '回答', 'failed'),
        ])
      ).toEqual([
        { role: 'user', content: '質問' },
        { role: 'assistant', content: '回答' },
      ]);
    });

    it('件数が上限を超えると、新しい方から上限件数だけ残す', () => {
      const messages = Array.from(
        { length: MAX_HISTORY_MESSAGES + 2 },
        (_, i) => msg('user', String(i))
      );
      const history = toConversationHistory(messages);
      expect(history).toHaveLength(MAX_HISTORY_MESSAGES);
      expect(history[0].content).toBe('2');
      expect(history.at(-1)?.content).toBe(String(MAX_HISTORY_MESSAGES + 1));
    });

    it('件数がちょうど上限なら全件残す（境界値）', () => {
      const messages = Array.from({ length: MAX_HISTORY_MESSAGES }, () =>
        msg('user', 'x')
      );
      expect(toConversationHistory(messages)).toHaveLength(
        MAX_HISTORY_MESSAGES
      );
    });
  });

  describe('異常系', () => {
    it('保存上限を超えて保存に失敗した assistant 応答は、上限まで切り詰める', () => {
      // 切り詰めずに送ると /api/chat が 400 を返し、その会話を続けられなくなる
      const [entry] = toConversationHistory([
        msg(
          'assistant',
          'あ'.repeat(MAX_ASSISTANT_MESSAGE_LENGTH + 5),
          'failed'
        ),
      ]);
      expect(entry.content).toHaveLength(MAX_ASSISTANT_MESSAGE_LENGTH);
    });

    it('user の本文は user の上限で切り詰める', () => {
      const [entry] = toConversationHistory([
        msg('user', 'あ'.repeat(MAX_MESSAGE_LENGTH + 1)),
      ]);
      expect(entry.content).toHaveLength(MAX_MESSAGE_LENGTH);
    });
  });
});
