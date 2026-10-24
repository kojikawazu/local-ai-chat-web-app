'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationSearchResult } from '@/types/conversation/conversation';

// 入力が止まってから検索するまでの待ち時間（ms）。1 文字ごとに API を呼ばないため
const SEARCH_DEBOUNCE_MS = 300;

/** 検索の進み具合。`idle` は検索していない（キーワードが空） */
type SearchStatus = 'idle' | 'loading' | 'done' | 'error';

/**
 * サイドバーの会話検索（#11）の状態と操作を管理するフック。
 *
 * キーワードの入力が {@link SEARCH_DEBOUNCE_MS} 止まったら `GET /api/conversations/search` を呼ぶ。
 * 新しい検索を始めるときは前の要求を中断し、古い結果で上書きしない。キーワードを空にすると
 * 検索をやめ、結果を捨てる。
 *
 * @returns 検索の状態と操作。`query` は入力中のキーワード、`status` は進み具合、
 *   `results` は結果（「さらに表示」で読んだ分を含む）、`hasMore` は続きの有無、
 *   `error` は失敗の理由（無ければ `null`）、`changeQuery` はキーワードを変える関数、
 *   `clear` は検索をやめる関数、`loadMore` は続きを読む関数
 */
export function useConversationSearch() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [results, setResults] = useState<ConversationSearchResult[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * 検索 API を呼び、結果を反映する。
   *
   * @param keyword - 前後の空白を除いたキーワード
   * @param offset - 何件目から読むか。0 なら結果を置き換え、それ以外なら後ろに足す
   */
  const runSearch = useCallback(async (keyword: string, offset: number) => {
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
      const res = await fetch(`/api/conversations/search?${params}`, {
        signal: controller.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `検索に失敗しました (${res.status})`);
      }
      const data: { results: ConversationSearchResult[]; hasMore: boolean } =
        await res.json();
      setResults((prev) =>
        offset === 0 ? data.results : [...prev, ...data.results]
      );
      setHasMore(data.hasMore);
      setStatus('done');
    } catch (err) {
      // 新しい検索・検索の取りやめで中断した。後から来た方が状態を持つ
      if (controller.signal.aborted) return;
      console.error('Failed to search conversations:', err);
      setError(err instanceof Error ? err.message : '検索に失敗しました');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    const keyword = query.trim();
    if (!keyword) return;
    const timeoutId = setTimeout(
      () => runSearch(keyword, 0),
      SEARCH_DEBOUNCE_MS
    );
    return () => clearTimeout(timeoutId);
  }, [query, runSearch]);

  const changeQuery = useCallback((value: string) => {
    setQuery(value);
    // 前のキーワードの結果を、今のキーワードの結果に見せない
    setResults([]);
    setHasMore(false);
    setError(null);
    if (value.trim()) {
      // 入力が止まるのを待つ間も「検索中」を出す
      setStatus('loading');
      return;
    }
    abortControllerRef.current?.abort();
    setStatus('idle');
  }, []);

  const clear = useCallback(() => changeQuery(''), [changeQuery]);

  const loadMore = useCallback(() => {
    runSearch(query.trim(), results.length);
  }, [query, results.length, runSearch]);

  return {
    query,
    status,
    results,
    hasMore,
    error,
    changeQuery,
    clear,
    loadMore,
  };
}
