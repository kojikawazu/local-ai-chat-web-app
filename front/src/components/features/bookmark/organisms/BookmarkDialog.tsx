'use client';

import { useState } from 'react';
import type { BookmarkListItem as BookmarkListItemData } from '@/types/bookmark/bookmark';
import { parseSearchTerms } from '@/lib/conversation/search';
import { MAX_SEARCH_QUERY_LENGTH } from '@/lib/shared/validation';
import { useBookmarks } from '@/hooks/bookmark/useBookmarks';
import Button from '@/components/common/atoms/Button';
import Modal from '@/components/common/molecules/Modal';
import SearchBox from '@/components/common/molecules/SearchBox';
import BookmarkListItem from '@/components/features/bookmark/molecules/BookmarkListItem';

/** {@link BookmarkDialog} の props。 */
type BookmarkDialogProps = {
  /** 行を押したときに呼ぶ。呼び出し側がダイアログを閉じ、元の会話の応答へ移る */
  onOpenBookmark: (bookmark: BookmarkListItemData) => void;
  /** ブックマークを外したときに呼ぶ。開いている会話の、その応答の印を消すため。引数は応答の ID */
  onRemoved: (messageId: string) => void;
  /** 閉じる要求（閉じるボタン・Escape）で呼ぶ */
  onClose: () => void;
};

/**
 * ブックマークの一覧のダイアログ（#30。`docs/21-bookmarks.md`「ブックマークの一覧」）。
 *
 * 付けた日時の新しい順に 20 件ずつ出し、検索欄のキーワードでメモ・応答の本文・会話のタイトルを絞り込む。
 * 行を押すと元の応答へ移り、行の中でメモを書く・外すことができる（メモの入力欄は同時に 1 つ）。
 * 開いている間だけ描画する（呼び出し側で条件付きで置く。開くたびに 1 ページ目から読む）。
 * メモの入力を失わないよう、背景のクリックでは閉じない。
 *
 * @param props - 移る・外した・閉じるときの処理
 */
export default function BookmarkDialog({
  onOpenBookmark,
  onRemoved,
  onClose,
}: BookmarkDialogProps) {
  const {
    query,
    status,
    bookmarks,
    hasMore,
    error,
    changeQuery,
    loadMore,
    updateNote,
    removeBookmark,
  } = useBookmarks();
  const [editingId, setEditingId] = useState<string | null>(null);
  const terms = parseSearchTerms(query);
  const isSearching = query.trim() !== '';

  return (
    <Modal
      title="ブックマーク"
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          閉じる
        </Button>
      }
    >
      <div className="space-y-4">
        <SearchBox
          value={query}
          onValueChange={changeQuery}
          onClear={() => changeQuery('')}
          label="ブックマークを検索"
          clearLabel="検索をやめる"
          maxLength={MAX_SEARCH_QUERY_LENGTH}
        />

        {bookmarks.length > 0 && (
          <ul aria-label="ブックマークの一覧" className="space-y-2">
            {bookmarks.map((bookmark) => (
              <BookmarkListItem
                key={bookmark.id}
                bookmark={bookmark}
                terms={terms}
                isEditing={editingId === bookmark.id}
                onStartEdit={() => setEditingId(bookmark.id)}
                onEndEdit={() => setEditingId(null)}
                onSaveNote={(note) => updateNote(bookmark.id, note)}
                onRemove={async () => {
                  const removed = await removeBookmark(bookmark.id);
                  if (removed) onRemoved(removed.messageId);
                }}
                onOpen={() => onOpenBookmark(bookmark)}
              />
            ))}
          </ul>
        )}

        <div role="status" className="text-sm text-nord-4/70">
          {status === 'loading' && '読み込み中…'}
          {status === 'done' &&
            bookmarks.length === 0 &&
            (isSearching
              ? '一致するブックマークは見つかりませんでした'
              : 'ブックマークはまだありません。応答の下のブックマークのボタンで付けられます')}
          {status === 'error' && (
            <span className="text-nord-aurora-red">{error}</span>
          )}
        </div>

        {status === 'done' && hasMore && (
          <Button
            variant="subtle"
            size="sm"
            onClick={loadMore}
            className="w-full"
          >
            さらに表示
          </Button>
        )}
      </div>
    </Modal>
  );
}
