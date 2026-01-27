'use client';

import { useState, useCallback, useRef } from 'react';
import { Message } from '@/types';

interface UseChatOptions {
  conversationId: string | null;
  model: string;
  onConversationCreated?: (id: string) => void;
  onTitleGenerated?: () => void;
}

async function saveMessage(
  conversationId: string,
  role: string,
  content: string
) {
  await fetch(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, content }),
  });
}

export function useChat({
  conversationId,
  model,
  onConversationCreated,
  onTitleGenerated,
}: UseChatOptions) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const loadMessages = useCallback(async (convId: string) => {
    try {
      const res = await fetch(`/api/conversations/${convId}/messages`);
      if (!res.ok) return;
      const data = await res.json();
      setMessages(
        data.messages.map(
          (msg: {
            id: string;
            role: string;
            content: string;
            createdAt: string;
          }) => ({
            ...msg,
            createdAt: new Date(msg.createdAt),
          })
        )
      );
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      setError(null);
      setIsLoading(true);

      let activeConversationId: string = conversationId || '';
      const isNewConversation = !activeConversationId;

      if (isNewConversation) {
        try {
          const res = await fetch('/api/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: content.slice(0, 100),
            }),
          });
          if (!res.ok) throw new Error('会話の作成に失敗しました');
          const conv = await res.json();
          activeConversationId = conv.id;
          onConversationCreated?.(conv.id);
        } catch (err) {
          const errorMessage =
            err instanceof Error ? err.message : '会話の作成に失敗しました';
          setError(errorMessage);
          setIsLoading(false);
          return;
        }
      }

      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        createdAt: new Date(),
      };

      const aiMessageId = crypto.randomUUID();
      const aiMessage: Message = {
        id: aiMessageId,
        role: 'assistant',
        content: '',
        createdAt: new Date(),
      };

      setMessages((prev) => [...prev, userMessage, aiMessage]);

      await saveMessage(activeConversationId, 'user', content).catch(
        console.error
      );

      const conversationHistory = messages.map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      }));

      abortControllerRef.current = new AbortController();

      let fullAiContent = '';

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: content,
            conversationHistory,
            model,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.error || `エラーが発生しました (${response.status})`
          );
        }

        if (!response.body) {
          throw new Error('レスポンスが空です');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value, { stream: true });
          fullAiContent += text;
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === aiMessageId
                ? { ...msg, content: msg.content + text }
                : msg
            )
          );
        }

        if (fullAiContent) {
          await saveMessage(
            activeConversationId,
            'assistant',
            fullAiContent
          ).catch(console.error);

          if (isNewConversation) {
            fetch(`/api/conversations/${activeConversationId}/generate-title`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: content, model }),
            })
              .then(() => onTitleGenerated?.())
              .catch(console.error);
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        const errorMessage =
          err instanceof Error ? err.message : '不明なエラーが発生しました';
        setError(errorMessage);
        setMessages((prev) => prev.filter((msg) => msg.id !== aiMessageId));
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [conversationId, model, messages, onConversationCreated, onTitleGenerated]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    clearMessages,
    loadMessages,
  };
}
