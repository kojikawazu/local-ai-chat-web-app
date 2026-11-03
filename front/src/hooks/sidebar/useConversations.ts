'use client';

import { useState, useCallback, useEffect } from 'react';
import type { Conversation } from '@/types/conversation/conversation';

/**
 * 会話一覧と選択中の会話 ID を管理し、会話の取得・作成・削除・選択を提供するフック。
 *
 * マウント時に会話一覧を API から取得する。各操作は API 失敗時にローカル状態を
 * 変更せず、エラーをコンソールに記録するに留める（例外は投げない）。ただし役割の変更
 * （`updateSystemPrompt`）とドキュメントの参照の切り替え（`updateKnowledgeEnabled`）は、失敗を画面に表示するため例外で返す。
 *
 * @returns 会話一覧と操作関数。`conversations` は会話一覧、
 *   `currentConversationId` は選択中の会話 ID（未選択時は `null`）、
 *   `createConversation` は新規会話を作成し作成した ID を返す（失敗時 `null`）、
 *   `deleteConversation` は会話を削除し、削除できたかを返す、`selectConversation` は選択中の会話を
 *   切り替える、`updateSystemPrompt` は会話の役割を変更する（失敗時は例外を投げる）、
 *   `updateKnowledgeEnabled` はドキュメントの参照（#17 Phase B）を切り替える（失敗時は例外を投げる）、
 *   `refreshConversations` は会話一覧を再取得する
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
    async (id: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/conversations/${id}`, {
          method: 'DELETE',
        });
        // 404 は別タブ等で既に削除済み。一覧に残すと消せない項目になるため、削除できたものとして扱う
        if (!res.ok && res.status !== 404) return false;
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (currentConversationId === id) {
          setCurrentConversationId(null);
        }
        return true;
      } catch (error) {
        console.error('Failed to delete conversation:', error);
        return false;
      }
    },
    [currentConversationId]
  );

  /**
   * 会話の設定を `PATCH` で変更し、一覧の該当会話を変更後の内容に差し替える。
   *
   * @param id - 対象の会話 ID
   * @param changes - 変える項目（送った項目だけが変わる）
   * @param failure - API がエラーの文言を返さなかったときのメッセージ
   * @throws {Error} API がエラーを返した、または通信に失敗した場合
   */
  const patchConversation = useCallback(
    async (
      id: string,
      changes: { systemPrompt?: string | null; knowledgeEnabled?: boolean },
      failure: string
    ) => {
      const res = await fetch(`/api/conversations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `${failure} (${res.status})`);
      }
      const updated: Conversation = await res.json();
      // 更新日時が変わり一覧の先頭に来るため、差し替えた上で並べ直す
      setConversations((prev) => [updated, ...prev.filter((c) => c.id !== id)]);
    },
    []
  );

  /**
   * 会話の役割（システムプロンプト）を変更し、一覧の該当会話を変更後の内容に差し替える（#10）。
   *
   * 他の操作と違い、失敗を例外で返す（編集ダイアログに失敗を表示し、入力を残すため）。
   *
   * @param id - 対象の会話 ID
   * @param systemPrompt - 新しい役割。空文字なら役割を外す
   * @throws {Error} API がエラーを返した、または通信に失敗した場合
   */
  const updateSystemPrompt = useCallback(
    (id: string, systemPrompt: string) =>
      patchConversation(
        id,
        { systemPrompt: systemPrompt || null },
        '役割の保存に失敗しました'
      ),
    [patchConversation]
  );

  /**
   * 会話のドキュメントの参照（#17 Phase B）を切り替え、一覧の該当会話を変更後の内容に差し替える。
   *
   * 失敗を例外で返す（切り替えが効かなかったことを画面に出すため）。
   *
   * @param id - 対象の会話 ID
   * @param knowledgeEnabled - 参照するなら true
   * @throws {Error} API がエラーを返した、または通信に失敗した場合
   */
  const updateKnowledgeEnabled = useCallback(
    (id: string, knowledgeEnabled: boolean) =>
      patchConversation(
        id,
        { knowledgeEnabled },
        'ドキュメントの参照の切り替えに失敗しました'
      ),
    [patchConversation]
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
    updateSystemPrompt,
    updateKnowledgeEnabled,
    refreshConversations: fetchConversations,
  };
}
