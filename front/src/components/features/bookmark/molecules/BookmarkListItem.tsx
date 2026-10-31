'use client';

import { useId, useState } from 'react';
import { NotebookPen } from 'lucide-react';
import type { BookmarkListItem as BookmarkListItemData } from '@/types/bookmark/bookmark';
import { splitHighlights } from '@/lib/conversation/search';
import { MAX_BOOKMARK_NOTE_LENGTH } from '@/lib/shared/validation';
import Button from '@/components/common/atoms/Button';
import TextArea from '@/components/common/atoms/TextArea';
import HighlightedText from '@/components/common/molecules/HighlightedText';

/** {@link BookmarkListItem} の props。 */
type BookmarkListItemProps = {
  /** 表示するブックマーク */
  bookmark: BookmarkListItemData;
  /** 強調するキーワード（`parseSearchTerms` で分けたもの） */
  terms: string[];
  /** メモの入力欄を開いているか。同時に開くのは 1 件だけなので、呼び出し側が持つ */
  isEditing: boolean;
  /** 「メモ」を押したときに呼ぶ（呼び出し側が、この行の入力欄を開く） */
  onStartEdit: () => void;
  /** 入力欄を閉じるときに呼ぶ（やめる・保存の成功） */
  onEndEdit: () => void;
  /** メモを保存する。失敗したら例外を投げる（入力欄の下に出し、入力を残す） */
  onSaveNote: (note: string) => Promise<void>;
  /** ブックマークを外す。失敗したら例外を投げる（行の下に出す） */
  onRemove: () => Promise<void>;
  /** 行を押したときに呼ぶ（元の応答へ移る） */
  onOpen: () => void;
};

// 付けた日時の表示（月/日 時:分）。年は出さない（一覧は新しい順で、古いものほど下にある）
const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

/**
 * 例外から画面に出す文言を取り出す。
 *
 * @param error - 捕まえた例外
 * @param fallback - `Error` でないときの文言
 * @returns 画面に出す文言
 */
function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * ブックマークの一覧の 1 件（#30。`docs/21-bookmarks.md`「ブックマークの一覧」）。
 *
 * 会話のタイトル・付けた日時・応答の抜粋・メモを出し、キーワードを強調する。行を押すと元の応答へ移る。
 * 「メモ」はこの行をメモの入力欄に替え、「外す」は行の中で 2 段階（「外す」→「はい、外す / やめる」）で確かめる。失敗は行の下に出し、入力を残す。
 *
 * @param props - ブックマーク・キーワード・入力欄の開閉と、保存・外す・移る処理
 */
export default function BookmarkListItem({
  bookmark,
  terms,
  isEditing,
  onStartEdit,
  onEndEdit,
  onSaveNote,
  onRemove,
  onOpen,
}: BookmarkListItemProps) {
  const noteId = useId();
  const [draft, setDraft] = useState(bookmark.note ?? '');
  const [isConfirmingRemove, setIsConfirmingRemove] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = () => {
    setDraft(bookmark.note ?? '');
    setError(null);
    setIsConfirmingRemove(false);
    onStartEdit();
  };

  const cancelEdit = () => {
    setError(null);
    onEndEdit();
  };

  const handleSave = async () => {
    setIsBusy(true);
    setError(null);
    try {
      await onSaveNote(draft);
      onEndEdit();
    } catch (err) {
      setError(errorMessage(err, 'メモの保存に失敗しました'));
    } finally {
      setIsBusy(false);
    }
  };

  const handleRemove = async () => {
    setIsBusy(true);
    setError(null);
    try {
      // 成功すると呼び出し側が一覧からこの行を消すため、後の状態は戻さない
      await onRemove();
    } catch (err) {
      setError(errorMessage(err, 'ブックマークを外せませんでした'));
      setIsBusy(false);
    }
  };

  return (
    <li
      aria-label={bookmark.conversationTitle}
      className="rounded-lg border border-nord-3 bg-nord-2"
    >
      <button
        type="button"
        onClick={onOpen}
        className="w-full rounded-t-lg px-3 pt-2 text-left transition-colors hover:bg-white/5"
      >
        <span className="flex items-baseline justify-between gap-3 text-sm">
          <span className="truncate font-semibold text-nord-6">
            <HighlightedText
              parts={splitHighlights(bookmark.conversationTitle, terms)}
            />
          </span>
          <time
            dateTime={bookmark.createdAt}
            className="shrink-0 font-mono text-xs text-nord-4/60"
          >
            {new Date(bookmark.createdAt).toLocaleString('ja-JP', DATE_FORMAT)}
          </time>
        </span>
        <span className="mt-1 line-clamp-2 text-xs text-nord-4/80">
          <HighlightedText parts={splitHighlights(bookmark.snippet, terms)} />
        </span>
        {bookmark.note && !isEditing && (
          <span className="mt-1 flex gap-1.5 text-xs text-nord-frost-1">
            <NotebookPen size={12} className="mt-0.5 shrink-0" />
            <span className="line-clamp-2 whitespace-pre-wrap">
              <HighlightedText parts={splitHighlights(bookmark.note, terms)} />
            </span>
          </span>
        )}
      </button>

      <div className="px-3 pb-2 pt-1">
        {isEditing ? (
          <div className="space-y-2">
            <label htmlFor={noteId} className="sr-only">
              メモ
            </label>
            <TextArea
              id={noteId}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={MAX_BOOKMARK_NOTE_LENGTH}
              rows={3}
              placeholder="あとで読み返すときの手がかり"
              className="w-full"
              autoFocus
            />
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-nord-4/60">
                {draft.length} / {MAX_BOOKMARK_NOTE_LENGTH}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={cancelEdit}
                  disabled={isBusy}
                >
                  やめる
                </Button>
                <Button size="sm" onClick={handleSave} disabled={isBusy}>
                  {isBusy ? '保存中…' : '保存'}
                </Button>
              </div>
            </div>
          </div>
        ) : isConfirmingRemove ? (
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={handleRemove} disabled={isBusy}>
              はい、外す
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setIsConfirmingRemove(false)}
              disabled={isBusy}
            >
              やめる
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={startEdit}
              disabled={isBusy}
            >
              メモ
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setError(null);
                setIsConfirmingRemove(true);
              }}
              disabled={isBusy}
            >
              外す
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-2 text-sm text-nord-aurora-red">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}
