'use client';

import { GitBranch, MessageSquare, Trash2 } from 'lucide-react';
import type { Conversation } from '@/types/conversation/conversation';
import { cn } from '@/lib/shared/class-names';
import IconButton from '@/components/common/atoms/IconButton';
import StatusDot from '@/components/common/atoms/StatusDot';

/** {@link ConversationListItem} の props。 */
type ConversationListItemProps = {
  /** 表示する会話 */
  conversation: Conversation;
  /** 選択中の会話か。背景を明るくし、`aria-current="page"` を付ける */
  isCurrent: boolean;
  /** 応答を生成中か。生成中の印を付ける（#147） */
  isGenerating: boolean;
  /** 削除ボタンを常に出すか。hover の無いドロワーでは true、デスクトップは hover・フォーカスの間だけ出す */
  alwaysShowDelete: boolean;
  /** 行を押したときに呼ばれる */
  onSelect: () => void;
  /** 削除ボタンを押したときに呼ばれる */
  onDelete: () => void;
};

/**
 * 会話の履歴の 1 行（#163 で `SidebarContent` から切り出し）。タイトル・生成中の印・削除ボタンを並べる。
 *
 * 分岐した会話（#29。分岐元が残っているもの）は、先頭のアイコンを分岐の印にする。
 *
 * @param props - 会話・選択と生成の状態・削除ボタンの出し方・押したときの処理
 */
export default function ConversationListItem({
  conversation,
  isCurrent,
  isGenerating,
  alwaysShowDelete,
  onSelect,
  onDelete,
}: ConversationListItemProps) {
  return (
    <div
      className={cn(
        'group flex items-center rounded-lg transition-all',
        isCurrent ? 'bg-white/10' : 'hover:bg-white/5'
      )}
    >
      <button
        onClick={onSelect}
        aria-current={isCurrent ? 'page' : undefined}
        className="flex-1 flex items-center gap-3 px-3 py-2.5 text-left text-sm text-nord-6 min-w-0"
      >
        {conversation.forkedFrom ? (
          <GitBranch
            size={16}
            role="img"
            aria-label="分岐した会話"
            className="text-nord-frost-1 shrink-0"
          />
        ) : (
          <MessageSquare size={16} className="text-nord-4/60 shrink-0" />
        )}
        <span className="truncate">{conversation.title}</span>
        {/* 別の会話を見ていても、裏で生成が続いていることがわかるようにする */}
        {isGenerating && <StatusDot pulse label="生成中" className="ml-auto" />}
      </button>
      <IconButton
        label={`「${conversation.title}」を削除`}
        tone="danger"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className={cn(
          'mr-1',
          alwaysShowDelete
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
        )}
      >
        <Trash2 size={14} />
      </IconButton>
    </div>
  );
}
