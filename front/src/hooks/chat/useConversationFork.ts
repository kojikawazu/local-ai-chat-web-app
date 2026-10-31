'use client';

import { useCallback, useState } from 'react';
import type { Conversation } from '@/types/conversation/conversation';

/** 分岐に失敗したときに画面のお知らせに出す文言（理由はログに残す）。 */
const FORK_ERROR_MESSAGE = '会話を分岐できませんでした';

/** {@link useConversationFork} の設定。 */
type UseConversationForkOptions = {
  /** 分岐できたときに呼ぶ。作られた会話（一覧の 1 件と同じ形）を受け取る。一覧の読み直しと、その会話を開くのは呼び出し側 */
  onForked: (conversation: Conversation) => void;
};

/**
 * 応答の下の「ここから分岐」で、その応答までのやり取りを新しい会話にコピーする（#29。`docs/22-conversation-fork.md`）。
 *
 * 返事を待つ間は `forkingMessageId` に押した応答の ID を持ち、ほかの分岐を始めない（二度押しで 2 つ作らない）。
 * 失敗したら、分岐元の会話の ID と文言を `error` に持つ。呼び出し側はその会話を開いている間だけお知らせに出す
 * （別の会話へ移ったら出さない）。次に分岐を始めると消える。
 *
 * @param options - 分岐できたときの処理（{@link UseConversationForkOptions}）
 * @returns `forkingMessageId` は返事を待っている応答の ID（無ければ `null`）、`error` は直前の失敗（分岐元の会話の ID と文言。無ければ `null`）、
 *   `fork` は会話の ID と応答の ID を受け取って分岐する関数
 */
export function useConversationFork({ onForked }: UseConversationForkOptions) {
  const [forkingMessageId, setForkingMessageId] = useState<string | null>(null);
  const [error, setError] = useState<{
    conversationId: string;
    message: string;
  } | null>(null);

  const fork = useCallback(
    async (conversationId: string, messageId: string) => {
      if (forkingMessageId !== null) return;
      setError(null);
      setForkingMessageId(messageId);
      try {
        const res = await fetch(`/api/conversations/${conversationId}/fork`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId }),
        });
        if (!res.ok) {
          throw new Error(`会話の分岐に失敗しました (${res.status})`);
        }
        const conversation: Conversation = await res.json();
        onForked(conversation);
      } catch (err) {
        console.error('Failed to fork conversation:', err);
        setError({ conversationId, message: FORK_ERROR_MESSAGE });
      } finally {
        setForkingMessageId(null);
      }
    },
    [forkingMessageId, onForked]
  );

  return { forkingMessageId, error, fork };
}
