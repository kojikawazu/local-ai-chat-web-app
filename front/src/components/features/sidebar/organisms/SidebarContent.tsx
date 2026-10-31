'use client';

import { Layout, Settings, Plus, History, Bookmark } from 'lucide-react';
import type { Conversation } from '@/types/conversation/conversation';
import ConversationSearch from './ConversationSearch';
import ConversationListItem from '@/components/features/sidebar/molecules/ConversationListItem';
import { useListNavigation } from '@/hooks/sidebar/useListNavigation';
import IconButton from '@/components/common/atoms/IconButton';

/**
 * SidebarContent コンポーネントの props。
 */
type SidebarContentProps = {
  /** 表示先。`'drawer'` はモバイルのドロワー内（hover が無い前提で操作ボタンを常時表示する） */
  variant: 'desktop' | 'drawer';
  /** 履歴として表示する会話一覧 */
  conversations: Conversation[];
  /** 選択中の会話 ID（未選択時は `null`） */
  currentConversationId: string | null;
  /** 応答を生成中の会話 ID。該当する会話に生成中の印を付ける（#147） */
  generatingConversationIds: string[];
  /** 新規会話モード中かどうか（true の間は新規作成ボタンを無効化する） */
  isNewConversationMode: boolean;
  /** 会話を選択したときに呼ばれる。引数は選択された会話 ID */
  onSelectConversation: (id: string) => void;
  /** 新規会話ボタン押下時に呼ばれる */
  onNewConversation: () => void;
  /** 会話削除ボタン押下時に呼ばれる。引数は削除対象の会話 ID */
  onDeleteConversation: (id: string) => void;
  /** 設定ボタン押下時に呼ばれる */
  onOpenSettings: () => void;
  /** ブックマークのボタン押下時に呼ばれる（一覧のダイアログを開く。#30） */
  onOpenBookmarks: () => void;
  /** 検索欄にフォーカスする要求（#33。⌘K・Ctrl+K）。`null` なら要求なし（`ConversationSearch` へ渡す） */
  searchFocusRequest?: number | null;
  /** 検索欄にフォーカスしたときに呼ばれる（呼び出し側が要求を消す） */
  onSearchFocused?: () => void;
};

/**
 * サイドバーの中身（ロゴ・新規会話ボタン・会話履歴・ブックマークと設定のボタン）。
 *
 * 応答を生成中の会話には点滅する印を付ける。履歴の上の検索欄で会話を探せる（#11）。
 * 履歴の一覧は ↑↓・Home・End で行を移れる（#33）。
 * デスクトップの {@link Sidebar} とモバイルの {@link SidebarDrawer} が共有し、
 * どちらの幅でも同じ操作を提供する。外枠（表示条件・幅・背景）は呼び出し側が持つ。
 *
 * @param props - 表示先・サイドバーの表示データとイベントハンドラー
 */
export default function SidebarContent({
  variant,
  conversations,
  currentConversationId,
  generatingConversationIds,
  isNewConversationMode,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onOpenSettings,
  onOpenBookmarks,
  searchFocusRequest = null,
  onSearchFocused,
}: SidebarContentProps) {
  const onListKeyDown = useListNavigation();

  return (
    <>
      <div className="p-6">
        <div className="flex items-center gap-3 mb-8">
          <div className="p-2 rounded-lg bg-nord-frost-1 text-nord-0">
            <Layout size={24} />
          </div>
          <h1 className="text-xl font-bold text-nord-6">Nordic Chat</h1>
        </div>

        <button
          onClick={onNewConversation}
          disabled={isNewConversationMode}
          className={`w-full flex items-center justify-center gap-2 py-3 px-4 mb-6 rounded-xl font-bold transition-all ${
            isNewConversationMode
              ? 'bg-nord-3 text-nord-4/40 cursor-not-allowed shadow-none'
              : 'bg-nord-frost-1 text-nord-0 hover:bg-nord-frost-2 shadow-[0_0_20px_rgba(136,192,208,0.5)] hover:shadow-[0_0_30px_rgba(136,192,208,0.7)]'
          }`}
        >
          <Plus size={18} />
          <span>New Conversation</span>
        </button>

        <ConversationSearch
          currentConversationId={currentConversationId}
          onSelectConversation={onSelectConversation}
          searchFocusRequest={searchFocusRequest}
          onSearchFocused={onSearchFocused}
        >
          <nav className="space-y-1">
            <p className="px-3 mb-4 text-xs font-semibold uppercase tracking-wider text-nord-4/60 flex items-center gap-2">
              <History size={14} />
              History
            </p>
            <div
              onKeyDown={onListKeyDown}
              className="space-y-1 overflow-y-auto max-h-[calc(100vh-380px)]"
            >
              {conversations.map((conv) => (
                <ConversationListItem
                  key={conv.id}
                  conversation={conv}
                  isCurrent={currentConversationId === conv.id}
                  isGenerating={generatingConversationIds.includes(conv.id)}
                  alwaysShowDelete={variant === 'drawer'}
                  onSelect={() => onSelectConversation(conv.id)}
                  onDelete={() => onDeleteConversation(conv.id)}
                />
              ))}
            </div>
          </nav>
        </ConversationSearch>
      </div>

      <div className="mt-auto p-6">
        <div className="flex gap-2 justify-center">
          <IconButton label="ブックマークを開く" onClick={onOpenBookmarks}>
            <Bookmark size={20} />
          </IconButton>
          <IconButton label="設定を開く" onClick={onOpenSettings}>
            <Settings size={20} />
          </IconButton>
        </div>
      </div>
    </>
  );
}
