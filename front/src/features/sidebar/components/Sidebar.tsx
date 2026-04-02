'use client';

import {
  Layout,
  MessageSquare,
  Settings,
  Plus,
  History,
  Trash2,
} from 'lucide-react';
import { Conversation } from '@/types';

interface SidebarProps {
  conversations: Conversation[];
  currentConversationId: string | null;
  isNewConversationMode: boolean;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onOpenSettings: () => void;
}

export default function Sidebar({
  conversations,
  currentConversationId,
  isNewConversationMode,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onOpenSettings,
}: SidebarProps) {
  return (
    <aside className="hidden md:flex w-72 flex-col h-full bg-nord-1 border-r border-nord-3">
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
          className={`w-full flex items-center justify-center gap-2 py-3 px-4 mb-8 rounded-xl font-bold transition-all ${
            isNewConversationMode
              ? 'bg-nord-3 text-nord-4/40 cursor-not-allowed shadow-none'
              : 'bg-nord-frost-1 text-nord-0 hover:bg-nord-frost-2 shadow-[0_0_20px_rgba(136,192,208,0.5)] hover:shadow-[0_0_30px_rgba(136,192,208,0.7)]'
          }`}
        >
          <Plus size={18} />
          <span>New Conversation</span>
        </button>

        <nav className="space-y-1">
          <p className="px-3 mb-4 text-xs font-semibold uppercase tracking-wider text-nord-4/60 flex items-center gap-2">
            <History size={14} />
            History
          </p>
          <div className="space-y-1 overflow-y-auto max-h-[calc(100vh-320px)]">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className={`group flex items-center rounded-lg transition-all ${
                  currentConversationId === conv.id
                    ? 'bg-white/10'
                    : 'hover:bg-white/5'
                }`}
              >
                <button
                  onClick={() => onSelectConversation(conv.id)}
                  className="flex-1 flex items-center gap-3 px-3 py-2.5 text-left text-sm text-nord-6 min-w-0"
                >
                  <MessageSquare
                    size={16}
                    className="text-nord-4/60 shrink-0"
                  />
                  <span className="truncate">{conv.title}</span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteConversation(conv.id);
                  }}
                  className="p-2 mr-1 rounded-lg text-nord-4/40 hover:text-nord-aurora-red opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </nav>
      </div>

      <div className="mt-auto p-6">
        <div className="flex gap-2 justify-center">
          <button
            onClick={onOpenSettings}
            aria-label="設定を開く"
            className="p-2 rounded-lg text-nord-4/60 hover:bg-white/5 transition-colors"
          >
            <Settings size={20} />
          </button>
        </div>
      </div>
    </aside>
  );
}
