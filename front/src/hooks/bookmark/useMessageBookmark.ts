'use client';

import { useCallback, useState } from 'react';
import type { Bookmark } from '@/types/bookmark/bookmark';
import type { Message } from '@/types/chat/message';

/** {@link useMessageBookmark} の設定。 */
type UseMessageBookmarkOptions = {
  /**
   * 付ける・外すが成功したときに呼ぶ。チャットの表示へ反映する（`useChat` の `setMessageBookmark`）。
   * 引数はメッセージの ID と、付いたブックマークの ID（外したときは `null`）
   */
  onChange: (messageId: string, bookmarkId: string | null) => void;
};

/**
 * 応答の下のボタンでブックマークを付ける・外す（#30）。
 *
 * 押すとすぐにボタンの表示を切り替え（`pending` に向かう先の状態を持つ）、API の結果を待つ間は同じ応答を押させない
 * （二度押しで 409 を出さないため）。成功したら `onChange` で表示に反映し、失敗したら元の表示に戻して
 * その応答に失敗を出す（次に押したときに消す）。
 *
 * @param options - 成功したときに表示へ反映する関数（{@link UseMessageBookmarkOptions}）
 * @returns `pending` は返事を待っている応答の ID → 向かう先（付けるなら true）、`failedMessageId` は直前に失敗した
 *   応答の ID（無ければ `null`）、`toggleBookmark` は応答のブックマークを付ける・外す関数
 */
export function useMessageBookmark({ onChange }: UseMessageBookmarkOptions) {
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [failedMessageId, setFailedMessageId] = useState<string | null>(null);

  const toggleBookmark = useCallback(
    async (message: Message) => {
      if (message.id in pending) return;
      const adding = !message.bookmarkId;
      setFailedMessageId(null);
      setPending((prev) => ({ ...prev, [message.id]: adding }));
      try {
        if (adding) {
          const res = await fetch('/api/bookmarks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messageId: message.id }),
          });
          if (!res.ok) {
            throw new Error(`ブックマークに失敗しました (${res.status})`);
          }
          const bookmark: Bookmark = await res.json();
          onChange(message.id, bookmark.id);
        } else {
          const res = await fetch(`/api/bookmarks/${message.bookmarkId}`, {
            method: 'DELETE',
          });
          // 404 はもう外れている（一覧で外した・別のタブで外した）。外れた状態にそろえる
          if (!res.ok && res.status !== 404) {
            throw new Error(`ブックマークを外せませんでした (${res.status})`);
          }
          onChange(message.id, null);
        }
      } catch (error) {
        // 画面には決まった文言を出す（ボタンの横に収めるため）。理由はログに残す
        console.error('Failed to toggle bookmark:', error);
        setFailedMessageId(message.id);
      } finally {
        setPending((prev) => {
          const next = { ...prev };
          delete next[message.id];
          return next;
        });
      }
    },
    [onChange, pending]
  );

  return { pending, failedMessageId, toggleBookmark };
}
