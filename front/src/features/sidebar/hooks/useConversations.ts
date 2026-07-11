'use client';

import { useState, useCallback, useEffect } from 'react';
import { Conversation } from '@/types';

/**
 * 会話一覧と選択中の会話 ID を管理し、会話の取得・作成・削除・選択を提供するフック。
 *
 * マウント時に会話一覧を API から取得する。各操作は API 失敗時にローカル状態を
 * 変更せず、エラーをコンソールに記録するに留める（例外は投げない）。
 *
 * @returns 会話一覧と操作関数。`conversations` は会話一覧、
 *   `currentConversationId` は選択中の会話 ID（未選択時は `null`）、
 *   `createConversation` は新規会話を作成し作成した ID を返す（失敗時 `null`）、
 *   `deleteConversation` は会話を削除する、`selectConversation` は選択中の会話を
 *   切り替える、`refreshConversations` は会話一覧を再取得する
 */
export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<
    string | null
  >(null);

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/conversations');
      if (!res.ok) return;
      const data = await res.json();
      setConversations(data.conversations);
    } catch (error) {
      console.error('Failed to fetch conversations:', error);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch('/api/conversations');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) {
          setConversations(data.conversations);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to fetch conversations:', error);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const createConversation = useCallback(
    async (title?: string): Promise<string | null> => {
      try {
        const res = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        });
        if (!res.ok) return null;
        const conversation = await res.json();
        setConversations((prev) => [conversation, ...prev]);
        setCurrentConversationId(conversation.id);
        return conversation.id;
      } catch (error) {
        console.error('Failed to create conversation:', error);
        return null;
      }
    },
    []
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/conversations/${id}`, {
          method: 'DELETE',
        });
        if (!res.ok) return;
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (currentConversationId === id) {
          setCurrentConversationId(null);
        }
      } catch (error) {
        console.error('Failed to delete conversation:', error);
      }
    },
    [currentConversationId]
  );

  const selectConversation = useCallback((id: string | null) => {
    setCurrentConversationId(id);
  }, []);

  return {
    conversations,
    currentConversationId,
    createConversation,
    deleteConversation,
    selectConversation,
    refreshConversations: fetchConversations,
  };
}
