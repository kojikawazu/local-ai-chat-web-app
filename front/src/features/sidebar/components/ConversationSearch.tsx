'use client';

import type { ReactNode } from 'react';
import { MessageSquare, Search } from 'lucide-react';
import { MAX_SEARCH_QUERY_LENGTH } from '@/lib/shared/validation';
import { parseSearchTerms, splitHighlights } from '@/lib/conversation/search';
import { useConversationSearch } from '../hooks/useConversationSearch';
import Button from '@/components/common/atoms/Button';
import Mark from '@/components/common/atoms/Mark';
import SearchBox from '@/components/common/molecules/SearchBox';

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
 * 文字列のうち、キーワードに一致した箇所を {@link Mark} で強調して描く。
 *
 * HTML を組み立てずに、分割した片を React の要素として並べる（XSS 対策。`security.md`）。
 *
 * @param props - 描く文字列とキーワード
 */
function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {splitHighlights(text, terms).map((part, i) =>
        part.match ? (
          <Mark key={i}>{part.text}</Mark>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </>
  );
}

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
              <button
                key={result.id}
                onClick={() => onSelectConversation(result.id)}
                aria-current={
                  currentConversationId === result.id ? 'page' : undefined
                }
                className={`w-full flex gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-all ${
                  currentConversationId === result.id
                    ? 'bg-white/10'
                    : 'hover:bg-white/5'
                }`}
              >
                <MessageSquare
                  size={16}
                  className="mt-0.5 shrink-0 text-nord-4/60"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-nord-6">
                    <Highlighted text={result.title} terms={terms} />
                  </span>
                  {result.snippet && (
                    <span className="mt-0.5 line-clamp-2 text-xs text-nord-4/70">
                      <Highlighted text={result.snippet} terms={terms} />
                    </span>
                  )}
                </span>
              </button>
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
