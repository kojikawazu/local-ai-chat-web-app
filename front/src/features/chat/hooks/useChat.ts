'use client';

import { useState, useCallback, useRef } from 'react';
import { Message, ToolCallInfo } from '@/types';
import type { AgentStreamEvent } from '@/lib/tools/types';

interface UseChatOptions {
  conversationId: string | null;
  model: string;
  enableTools?: boolean;
  onConversationCreated?: (id: string) => void;
  onTitleGenerated?: () => void;
}

async function saveMessage(
  conversationId: string,
  role: string,
  content: string,
  metadata?: { toolCalls?: ToolCallInfo[] } | null
) {
  await fetch(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, content, metadata }),
  });
}

export function useChat({
  conversationId,
  model,
  enableTools = false,
  onConversationCreated,
  onTitleGenerated,
}: UseChatOptions) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeToolCall, setActiveToolCall] = useState<{
    name: string;
    arguments: Record<string, unknown>;
  } | null>(null);
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
            metadata?: { toolCalls?: ToolCallInfo[] } | null;
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
      setActiveToolCall(null);

      let activeConversationId: string = conversationId || '';
      const isNewConversation = !activeConversationId;

      if (isNewConversation) {
        try {
          const res = await fetch('/api/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: content.slice(0, 100) }),
          });
          if (!res.ok) throw new Error('会話の作成に失敗しました');
          const conv = await res.json();
          activeConversationId = conv.id;
          onConversationCreated?.(conv.id);
        } catch (err) {
          setError(err instanceof Error ? err.message : '会話の作成に失敗しました');
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

      await saveMessage(activeConversationId, 'user', content).catch(console.error);

      const conversationHistory = messages.map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      }));

      abortControllerRef.current = new AbortController();

      let fullAiContent = '';
      const toolCallRecords: ToolCallInfo[] = [];
      // tool_call_start で受け取った arguments を tool_call_result まで保持する
      // 同名ツールが複数回呼ばれる場合に備え、FIFO キューで管理
      const pendingToolArgs = new Map<string, Array<Record<string, unknown>>>();

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: content,
            conversationHistory,
            model,
            enableTools,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.error || `エラーが発生しました (${response.status})`
          );
        }

        if (!response.body) throw new Error('レスポンスが空です');

        const contentType = response.headers.get('Content-Type') ?? '';
        const isNdjson = contentType.includes('application/x-ndjson');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        if (isNdjson) {
          // --- エージェントモード: NDJSON イベントストリーム ---
          let lineBuffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            lineBuffer += decoder.decode(value, { stream: true });
            const lines = lineBuffer.split('\n');
            lineBuffer = lines.pop() ?? '';

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const event: AgentStreamEvent = JSON.parse(line);

                if (event.type === 'text_delta') {
                  fullAiContent += event.content;
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === aiMessageId
                        ? { ...msg, content: msg.content + event.content }
                        : msg
                    )
                  );
                } else if (event.type === 'tool_call_start') {
                  setActiveToolCall({ name: event.name, arguments: event.arguments });
                  // arguments を pending キューに積む
                  const queue = pendingToolArgs.get(event.name) ?? [];
                  queue.push(event.arguments);
                  pendingToolArgs.set(event.name, queue);
                  // ツール実行中を UI に反映
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === aiMessageId
                        ? {
                            ...msg,
                            metadata: {
                              ...msg.metadata,
                              toolCalls: [
                                ...(msg.metadata?.toolCalls ?? []),
                                {
                                  name: event.name,
                                  arguments: event.arguments,
                                  result: '',
                                  isError: false,
                                  durationMs: 0,
                                },
                              ],
                            },
                          }
                        : msg
                    )
                  );
                } else if (event.type === 'tool_call_result') {
                  setActiveToolCall(null);
                  // pending キューから先頭の arguments を取り出す（FIFO）
                  const argsQueue = pendingToolArgs.get(event.name) ?? [];
                  const resolvedArgs = argsQueue.shift() ?? {};
                  if (argsQueue.length === 0) {
                    pendingToolArgs.delete(event.name);
                  } else {
                    pendingToolArgs.set(event.name, argsQueue);
                  }
                  const record: ToolCallInfo = {
                    name: event.name,
                    arguments: resolvedArgs,
                    result: event.result,
                    isError: event.isError,
                    durationMs: 0,
                  };
                  toolCallRecords.push(record);
                  // 最後のツール呼び出しレコードを結果で更新
                  setMessages((prev) =>
                    prev.map((msg) => {
                      if (msg.id !== aiMessageId) return msg;
                      const toolCalls = [...(msg.metadata?.toolCalls ?? [])];
                      const idx = toolCalls.map((t) => t.name).lastIndexOf(event.name);
                      if (idx >= 0) {
                        toolCalls[idx] = {
                          ...toolCalls[idx],
                          result: event.result,
                          isError: event.isError,
                        };
                      }
                      return { ...msg, metadata: { toolCalls } };
                    })
                  );
                } else if (event.type === 'done') {
                  if (event.metadata?.toolCalls) {
                    // durationMs を done イベントの値で更新
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === aiMessageId
                          ? {
                              ...msg,
                              metadata: { toolCalls: event.metadata!.toolCalls },
                            }
                          : msg
                      )
                    );
                    toolCallRecords.length = 0;
                    toolCallRecords.push(...event.metadata.toolCalls);
                  }
                } else if (event.type === 'error') {
                  throw new Error(event.message);
                }
              } catch (parseErr) {
                // JSON パース失敗は無視（不完全な行等）
                if (parseErr instanceof SyntaxError) continue;
                throw parseErr;
              }
            }
          }
        } else {
          // --- 通常モード: プレーンテキストストリーミング（後方互換） ---
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
        }

        if (fullAiContent) {
          const metadata =
            toolCallRecords.length > 0 ? { toolCalls: toolCallRecords } : null;
          await saveMessage(
            activeConversationId,
            'assistant',
            fullAiContent,
            metadata
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
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : '不明なエラーが発生しました');
        setMessages((prev) => prev.filter((msg) => msg.id !== aiMessageId));
      } finally {
        setIsLoading(false);
        setActiveToolCall(null);
        abortControllerRef.current = null;
      }
    },
    [conversationId, model, enableTools, messages, onConversationCreated, onTitleGenerated]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setActiveToolCall(null);
  }, []);

  return {
    messages,
    isLoading,
    error,
    activeToolCall,
    sendMessage,
    clearMessages,
    loadMessages,
  };
}
