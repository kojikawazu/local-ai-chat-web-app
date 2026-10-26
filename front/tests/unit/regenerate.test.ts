import { describe, it, expect } from 'vitest';
import { findRegenerateTarget } from '@/lib/chat/regenerate';
import type { Message } from '@/types/chat/message';

/**
 * `lib/chat/regenerate` の UT（#9）。
 * 再生成できる応答の判定（最後・assistant・保存済み・直前に保存済みの質問）と、送り直す
 * 質問・履歴の範囲を確かめる。ボタンの表示（`ChatWindow`）と実行（`useChat`）が同じ判定を使うため、
 * 判定の食い違いはここで検出する。純関数のため mock は使わない。
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

describe('findRegenerateTarget', () => {
  describe('正常系', () => {
    it('最後の応答なら、直前の質問とそれより前の履歴を返す', () => {
      const messages = [
        msg('user', '1つ目の質問'),
        msg('assistant', '1つ目の回答'),
        msg('user', '2つ目の質問'),
        msg('assistant', '不満な回答'),
      ];

      expect(findRegenerateTarget(messages, messages[3].id)).toEqual({
        target: messages[3],
        prompt: '2つ目の質問',
        imageIds: [],
        history: [
          { role: 'user', content: '1つ目の質問' },
          { role: 'assistant', content: '1つ目の回答' },
        ],
      });
    });

    it('画像付きの質問なら、その画像の ID も返す（#6。画像ごと送り直す）', () => {
      const question: Message = {
        ...msg('user', 'これは？'),
        images: [
          { id: 'img-1', src: '/api/attachments/img-1', width: 10, height: 10 },
          { id: 'img-2', src: '/api/attachments/img-2', width: 10, height: 10 },
        ],
      };
      const messages = [question, msg('assistant', '回答')];

      expect(findRegenerateTarget(messages, messages[1].id)?.imageIds).toEqual([
        'img-1',
        'img-2',
      ]);
    });

    it('最初のやり取りなら履歴は空', () => {
      const messages = [msg('user', '質問'), msg('assistant', '回答')];

      expect(findRegenerateTarget(messages, messages[1].id)?.history).toEqual(
        []
      );
    });
  });

  describe('準正常系', () => {
    it('中断した応答（metadata.interrupted）も再生成できる', () => {
      const messages = [
        msg('user', '質問'),
        { ...msg('assistant', '途中まで'), metadata: { interrupted: true } },
      ];

      expect(findRegenerateTarget(messages, messages[1].id)).not.toBeNull();
    });

    it('最後でない応答は再生成できない（後続のやり取りと食い違うため）', () => {
      const messages = [
        msg('user', '1つ目'),
        msg('assistant', '回答'),
        msg('user', '2つ目'),
        msg('assistant', '回答2'),
      ];

      expect(findRegenerateTarget(messages, messages[1].id)).toBeNull();
    });

    it('保存に失敗した応答は再生成できない（DB に置き換える対象が無い）', () => {
      const messages = [
        msg('user', '質問'),
        msg('assistant', '回答', 'failed'),
      ];

      expect(findRegenerateTarget(messages, messages[1].id)).toBeNull();
    });

    it('質問の送信に失敗していれば再生成できない', () => {
      const messages = [
        msg('user', '質問', 'failed'),
        msg('assistant', '回答'),
      ];

      expect(findRegenerateTarget(messages, messages[1].id)).toBeNull();
    });
  });

  describe('異常系', () => {
    it('メッセージが空なら null', () => {
      expect(findRegenerateTarget([], crypto.randomUUID())).toBeNull();
    });

    it('存在しない ID なら null', () => {
      const messages = [msg('user', '質問'), msg('assistant', '回答')];

      expect(findRegenerateTarget(messages, crypto.randomUUID())).toBeNull();
    });

    it('最後が user メッセージなら null（応答が無い）', () => {
      const messages = [msg('user', '質問')];

      expect(findRegenerateTarget(messages, messages[0].id)).toBeNull();
    });

    it('直前が質問でない応答は null（送り直す質問が無い）', () => {
      const messages = [msg('assistant', '回答')];

      expect(findRegenerateTarget(messages, messages[0].id)).toBeNull();
    });
  });
});
