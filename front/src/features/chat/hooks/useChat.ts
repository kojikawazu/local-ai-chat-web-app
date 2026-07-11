'use client';

import { useState, useCallback, useRef } from 'react';
import { Message, ToolCallInfo } from '@/types';
import type { AgentStreamEvent } from '@/lib/tools/types';

/** {@link useChat} の設定オプション。 */
interface UseChatOptions {
  /** 送信対象の会話 ID。`null` の場合は送信時に新規会話を作成する。 */
  conversationId: string | null;
  /** 使用する Ollama モデル名。 */
  model: string;
  /** エージェント（ツール実行）モードを有効にするか。省略時は無効。 */
  enableTools?: boolean;
  /** システムプロンプト。空文字の場合は API へ送信しない。省略時は空。 */
  systemPrompt?: string;
  /** 新規会話が作成されたときのコールバック。作成された会話 ID を受け取る。 */
  onConversationCreated?: (id: string) => void;
  /** 初回応答後にタイトル自動生成が完了したときのコールバック。 */
  onTitleGenerated?: () => void;
}

/**
 * メッセージを会話に永続化する（API 経由で保存）。
 *
 * 応答成否は呼び出し側でハンドリングする想定（本関数は結果を返さない）。
 *
 * @param conversationId - 保存先の会話 ID
 * @param role - メッセージの役割（`'user'` | `'assistant'`）
 * @param content - メッセージ本文
 * @param metadata - ツール呼び出し情報等の付随メタデータ（無ければ省略・`null`）
 */
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

/**
 * チャットのメッセージ状態と送受信ロジックを管理するフック。
 *
 * メッセージ送信時に `/api/chat` へストリーミング要求を行い、NDJSON（エージェント
 * モード）とプレーンテキスト（通常モード）の両方式を扱う。会話 ID が未指定なら
 * 新規会話を作成し、初回応答後はタイトル自動生成を要求する。ユーザー・アシスタント
 * 両メッセージは API へ永続化する。中断は内部の `AbortController` で扱う。
 *
 * @param options - フックの設定（{@link UseChatOptions}）。会話 ID・モデル・
 *   エージェント有効化・システムプロンプトと、会話作成／タイトル生成完了時の
 *   コールバックを含む。各フィールドの意味は {@link UseChatOptions} を参照。
 * @returns チャット状態と操作関数。`messages` は現在のメッセージ一覧、`isLoading` は
 *   送信・応答生成中フラグ、`error` は直近のエラーメッセージ（無ければ `null`）、
 *   `activeToolCall` は実行中のツール呼び出し（無ければ `null`）、`sendMessage` は
 *   本文を送信して応答をストリーム受信する関数、`clearMessages` はメッセージ・エラー・
 *   実行中ツールを初期化する関数、`loadMessages` は指定会話のメッセージを読み込む関数
 */
export function useChat({
  conversationId,
  model,
  enableTools = false,
  systemPrompt = '',
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
      let thinkingText = '';
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
            systemPrompt: systemPrompt || undefined,
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

                if (event.type === 'thinking') {
                  thinkingText += event.content;
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === aiMessageId
                        ? { ...msg, metadata: { ...msg.metadata, thinkingText } }
                        : msg
                    )
                  );
                } else if (event.type === 'text_delta') {
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
                      return { ...msg, metadata: { ...msg.metadata, toolCalls } };
                    })
                  );
                } else if (event.type === 'done') {
                  // done イベントで metadata（toolCalls・統計）を最終確定
                  setMessages((prev) =>
                    prev.map((msg) => {
                      if (msg.id !== aiMessageId) return msg;
                      return {
                        ...msg,
                        metadata: {
                          ...(event.metadata?.toolCalls && { toolCalls: event.metadata.toolCalls }),
                          ...(thinkingText && { thinkingText }),
                          ...(event.metadata?.agentRounds !== undefined && { agentRounds: event.metadata.agentRounds }),
                          ...(event.metadata?.agentDurationMs !== undefined && { agentDurationMs: event.metadata.agentDurationMs }),
                        },
                      };
                    })
                  );
                  if (event.metadata?.toolCalls) {
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
    [conversationId, model, enableTools, systemPrompt, messages, onConversationCreated, onTitleGenerated]
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
