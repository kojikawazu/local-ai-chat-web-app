'use client';

import { MessageSquare } from 'lucide-react';
import type { ConversationSearchResult } from '@/types/conversation/conversation';
import { splitHighlights } from '@/lib/conversation/search';
import { cn } from '@/lib/shared/class-names';
import { LIST_ITEM_ATTRIBUTE } from '@/constants/sidebar/list';
import HighlightedText from '@/components/common/molecules/HighlightedText';

/** {@link SearchResultItem} の props。 */
type SearchResultItemProps = {
  /** 表示する検索結果 */
  result: ConversationSearchResult;
  /** 強調するキーワード（`parseSearchTerms` で分けたもの） */
  terms: string[];
  /** 選択中の会話か。背景を明るくし、`aria-current="page"` を付ける */
  isCurrent: boolean;
  /** 押したときに呼ばれる */
  onSelect: () => void;
};

/**
 * 会話検索の結果の 1 件（#163 で `ConversationSearch` から切り出し）。タイトルと一致箇所の抜粋を、キーワードを強調して出す。
 *
 * @param props - 検索結果・キーワード・選択の状態・押したときの処理
 */
export default function SearchResultItem({
  result,
  terms,
  isCurrent,
  onSelect,
}: SearchResultItemProps) {
  return (
    <button
      onClick={onSelect}
      aria-current={isCurrent ? 'page' : undefined}
      // 一覧の ↑↓ で移る行の目印（#33）
      {...{ [LIST_ITEM_ATTRIBUTE]: '' }}
      className={cn(
        'w-full flex gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-all',
        isCurrent ? 'bg-white/10' : 'hover:bg-white/5'
      )}
    >
      <MessageSquare size={16} className="mt-0.5 shrink-0 text-nord-4/60" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-nord-6">
          <HighlightedText parts={splitHighlights(result.title, terms)} />
        </span>
        {result.snippet && (
          <span className="mt-0.5 line-clamp-2 text-xs text-nord-4/70">
            <HighlightedText parts={splitHighlights(result.snippet, terms)} />
          </span>
        )}
      </span>
    </button>
  );
}
