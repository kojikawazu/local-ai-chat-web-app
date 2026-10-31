'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import { MAX_SEARCH_QUERY_LENGTH } from '@/lib/shared/validation';
import { parseSearchTerms } from '@/lib/conversation/search';
import { useConversationSearch } from '@/hooks/sidebar/useConversationSearch';
import { useListNavigation } from '@/hooks/sidebar/useListNavigation';
import Button from '@/components/common/atoms/Button';
import SearchBox from '@/components/common/molecules/SearchBox';
import SearchResultItem from '@/components/features/sidebar/molecules/SearchResultItem';

/** {@link ConversationSearch} の props。 */
type ConversationSearchProps = {
  /** 選択中の会話 ID（未選択時は `null`）。検索結果でも選択中の会話を示す */
  currentConversationId: string | null;
  /** 検索結果の会話を押したときに呼ばれる。引数は会話 ID */
  onSelectConversation: (id: string) => void;
  /** 検索していないときに出す内容（会話の履歴一覧） */
  children: ReactNode;
  /**
   * 検索欄にフォーカスする要求（#33。⌘K・Ctrl+K）。`null` 以外になったら、この検索欄が画面に見えていればフォーカスし、
   * {@link ConversationSearchProps.onSearchFocused} を呼ぶ（見えていなければ、見えている方の検索欄に任せる）
   */
  searchFocusRequest?: number | null;
  /** 検索欄にフォーカスしたときに呼ぶ（呼び出し側が要求を消す） */
  onSearchFocused?: () => void;
};

/**
 * サイドバーの会話検索（#11）。検索欄と、キーワードがある間は履歴一覧の代わりに検索結果を出す。
 *
 * 結果にはタイトルと一致箇所の抜粋を出し、キーワードを強調する。結果を押すとその会話を開く。
 * × ボタン・Escape で検索をやめて履歴一覧に戻る（Escape は検索中だけ受け取り、ドロワーを閉じさせない）。
 * 結果の一覧は ↑↓・Home・End で行を移れる（#33）。フォーカスの要求（⌘K）が来たら、見えている検索欄だけがフォーカスする
 * （デスクトップのサイドバーとドロワーの両方に置かれるため）。
 *
 * @param props - 選択中の会話・会話を開くハンドラーと、検索していないときの内容
 */
export default function ConversationSearch({
  currentConversationId,
  onSelectConversation,
  children,
  searchFocusRequest = null,
  onSearchFocused,
}: ConversationSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const onListKeyDown = useListNavigation();

  useEffect(() => {
    if (searchFocusRequest === null) return;
    // ドロワーは開いた直後に先頭の要素へフォーカスを移すため、その後に移す。
    // サイドバーを開いた直後も、幅 0・inert が外れてから移す
    const timer = setTimeout(() => {
      const input = inputRef.current;
      // md 未満のデスクトップのサイドバー（display: none）・隠したサイドバー（inert）の検索欄は見えていない
      if (!input || input.offsetParent === null || input.closest('[inert]')) {
        return;
      }
      input.focus();
      onSearchFocused?.();
    }, 0);
    return () => clearTimeout(timer);
  }, [searchFocusRequest, onSearchFocused]);

  const {
    query,
    status,
    results,
    hasMore,
    error,
    changeQuery,
    clear,
    loadMore,
  } = useConversationSearch();
  const terms = parseSearchTerms(query);

  return (
    <>
      <SearchBox
        ref={inputRef}
        value={query}
        onValueChange={changeQuery}
        onClear={clear}
        label="会話を検索"
        clearLabel="検索をやめる"
        maxLength={MAX_SEARCH_QUERY_LENGTH}
        className="mb-6"
      />

      {status === 'idle' ? (
        children
      ) : (
        <section aria-label="検索結果" className="space-y-1">
          <p className="px-3 mb-4 text-xs font-semibold uppercase tracking-wider text-nord-4/60 flex items-center gap-2">
            <Search size={14} />
            Results
          </p>
          <div
            onKeyDown={onListKeyDown}
            className="space-y-1 overflow-y-auto max-h-[calc(100vh-380px)]"
          >
            {results.map((result) => (
              <SearchResultItem
                key={result.id}
                result={result}
                terms={terms}
                isCurrent={currentConversationId === result.id}
                onSelect={() => onSelectConversation(result.id)}
              />
            ))}
            <div role="status" className="px-3 py-2 text-xs text-nord-4/60">
              {status === 'loading' && '検索中…'}
              {status === 'done' &&
                results.length === 0 &&
                '一致する会話は見つかりませんでした'}
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
        </section>
      )}
    </>
  );
}
