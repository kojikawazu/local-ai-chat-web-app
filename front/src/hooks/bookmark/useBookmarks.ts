'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Bookmark, BookmarkListItem } from '@/types/bookmark/bookmark';

// 入力が止まってから読み直すまでの待ち時間（ms）。会話の検索と同じ
const SEARCH_DEBOUNCE_MS = 300;

/** 一覧の読み込みの進み具合 */
type BookmarksStatus = 'loading' | 'done' | 'error';

/**
 * 失敗した応答の本文から、利用者へ出す文言を取り出す。
 *
 * @param res - 失敗した応答
 * @param fallback - 本文から取り出せないときの文言
 * @returns エラーの文言
 */
async function errorMessageOf(
  res: Response,
  fallback: string
): Promise<string> {
  const data: unknown = await res.json().catch(() => null);
  if (
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof data.error === 'string'
  ) {
    return data.error;
  }
  return fallback;
}

/**
 * ブックマークの一覧（#30）の状態と操作を管理するフック。一覧のダイアログを開いている間だけ使う。
 *
 * 使い始めに 1 ページ目（新しい順）を読む。キーワードを変えたら {@link SEARCH_DEBOUNCE_MS} 待ってから読み直し、
 * 新しい読み込みを始めるときは前の要求を中断する（古い結果で上書きしない）。キーワードを空にすると全件に戻す。
 * メモの書き換え・外すは、成功したら一覧の行に反映する。失敗したら文言を投げる（入力欄の下に出すため）。
 *
 * @returns 一覧の状態と操作。`query` は入力中のキーワード、`status` は読み込みの進み具合、`bookmarks` は読んだ分の一覧、
 *   `hasMore` は続きの有無、`error` は読み込みの失敗の理由（無ければ `null`）、`changeQuery` はキーワードを変える関数、
 *   `loadMore` は続きを読む関数、`updateNote` はメモを書き換える関数、`removeBookmark` は外す関数（外したブックマークを返す）
 */
export function useBookmarks() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<BookmarksStatus>('loading');
  const [bookmarks, setBookmarks] = useState<BookmarkListItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * 一覧の API を呼び、結果を反映する。
   *
   * @param keyword - 前後の空白を除いたキーワード（空なら全件）
   * @param offset - 何件目から読むか。0 なら一覧を置き換え、それ以外なら後ろに足す
   */
  const load = useCallback(async (keyword: string, offset: number) => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setStatus('loading');
    setError(null);
    try {
      const params = new URLSearchParams({
        q: keyword,
        offset: String(offset),
      });
      const res = await fetch(`/api/bookmarks?${params}`, {
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(
          await errorMessageOf(
            res,
            `ブックマークの取得に失敗しました (${res.status})`
          )
        );
      }
      const data: { bookmarks: BookmarkListItem[]; hasMore: boolean } =
        await res.json();
      setBookmarks((prev) =>
        offset === 0 ? data.bookmarks : [...prev, ...data.bookmarks]
      );
      setHasMore(data.hasMore);
      setStatus('done');
    } catch (err) {
      // 新しい読み込み・ダイアログを閉じたことで中断した。後から来た方が状態を持つ
      if (controller.signal.aborted) return;
      console.error('Failed to load bookmarks:', err);
      setError(
        err instanceof Error ? err.message : 'ブックマークの取得に失敗しました'
      );
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    const keyword = query.trim();
    // 開いた直後（キーワードが空）は待たずに読む
    const delay = keyword ? SEARCH_DEBOUNCE_MS : 0;
    const timeoutId = setTimeout(() => load(keyword, 0), delay);
    return () => clearTimeout(timeoutId);
  }, [query, load]);

  // 閉じた（使わなくなった）後に届く結果で状態を更新しない
  useEffect(() => () => abortControllerRef.current?.abort(), []);

  const changeQuery = useCallback((value: string) => {
    setQuery(value);
    // 前のキーワードの結果を、今のキーワードの結果に見せない
    setBookmarks([]);
    setHasMore(false);
    setError(null);
    // 入力が止まるのを待つ間も「読み込み中」を出す
    setStatus('loading');
  }, []);

  const loadMore = useCallback(() => {
    load(query.trim(), bookmarks.length);
  }, [query, bookmarks.length, load]);

  /**
   * メモを書き換える。成功したら一覧の行に反映する。
   *
   * @param id - ブックマークの ID
   * @param note - 新しいメモ（空なら消す）
   * @throws {Error} 書き換えに失敗した場合（API の `error` の文言）
   */
  const updateNote = useCallback(async (id: string, note: string) => {
    const res = await fetch(`/api/bookmarks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: note.trim() ? note : null }),
    });
    if (!res.ok) {
      throw new Error(
        await errorMessageOf(res, `メモの保存に失敗しました (${res.status})`)
      );
    }
    const updated: Bookmark = await res.json();
    setBookmarks((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, note: updated.note } : item
      )
    );
  }, []);

  /**
   * ブックマークを外し、一覧から消す。もう無かった（404）ときも一覧から消す。
   *
   * @param id - ブックマークの ID
   * @returns 外したブックマーク（開いている会話の印を消すため、呼び出し側が `messageId` を使う）
   * @throws {Error} 外すのに失敗した場合（API の `error` の文言）
   */
  const removeBookmark = useCallback(
    async (id: string): Promise<BookmarkListItem | undefined> => {
      const res = await fetch(`/api/bookmarks/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) {
        throw new Error(
          await errorMessageOf(
            res,
            `ブックマークを外せませんでした (${res.status})`
          )
        );
      }
      const removed = bookmarks.find((item) => item.id === id);
      setBookmarks((prev) => prev.filter((item) => item.id !== id));
      return removed;
    },
    [bookmarks]
  );

  return {
    query,
    status,
    bookmarks,
    hasMore,
    error,
    changeQuery,
    loadMore,
    updateNote,
    removeBookmark,
  };
}
