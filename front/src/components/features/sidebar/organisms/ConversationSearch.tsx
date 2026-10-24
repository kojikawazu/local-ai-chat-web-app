'use client';

import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { MAX_SEARCH_QUERY_LENGTH } from '@/lib/shared/validation';
import { parseSearchTerms } from '@/lib/conversation/search';
import { useConversationSearch } from '@/hooks/sidebar/useConversationSearch';
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
};

/**
 * サイドバーの会話検索（#11）。検索欄と、キーワードがある間は履歴一覧の代わりに検索結果を出す。
 *
 * 結果にはタイトルと一致箇所の抜粋を出し、キーワードを強調する。結果を押すとその会話を開く。
 * × ボタン・Escape で検索をやめて履歴一覧に戻る（Escape は検索中だけ受け取り、ドロワーを閉じさせない）。
 *
 * @param props - 選択中の会話・会話を開くハンドラーと、検索していないときの内容
 */
export default function ConversationSearch({
  currentConversationId,
  onSelectConversation,
  children,
}: ConversationSearchProps) {
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
          <div className="space-y-1 overflow-y-auto max-h-[calc(100vh-380px)]">
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
