'use client';

import { useState, useCallback, useRef } from 'react';
import type {
  HistoryEntry,
  Message,
  MessageSaveState,
  ToolCallInfo,
} from '@/types';
import type { AgentStreamEvent } from '@/lib/tools/types';
import { MAX_TITLE_LENGTH } from '@/lib/validation';
import { toConversationHistory } from '@/lib/conversation-history';
import { findRegenerateTarget } from '@/lib/regenerate';
import { buildSystemPrompt } from '@/lib/system-prompt';
import {
  buildMessageMetadata,
  parseMessageMetadata,
} from '@/lib/message-metadata';

/** {@link useChat} の設定オプション。 */
interface UseChatOptions {
  /** 送信対象の会話 ID。`null` の場合は送信時に新規会話を作成する。 */
  conversationId: string | null;
  /** 使用する Ollama モデル名。 */
  model: string;
  /** エージェント（ツール実行）モードを有効にするか。省略時は無効。 */
  enableTools?: boolean;
  /**
   * 会話の役割（システムプロンプト。#10）。新規会話の作成時は会話に保存し、送信時は
   * {@link UseChatOptions.agentPrompt} と連結して API へ送る。省略時は空（役割なし）。
   */
  systemPrompt?: string;
  /** エージェントモードのプリセットの本文。役割の後ろに連結して送る。通常モードでは空にする。省略時は空。 */
  agentPrompt?: string;
  /** 新規会話が作成されたときのコールバック。作成された会話 ID を受け取る。 */
  onConversationCreated?: (id: string) => void;
  /** 初回応答後にタイトル自動生成が完了したときのコールバック。 */
  onTitleGenerated?: () => void;
}

/** 保存に失敗したメッセージの再試行に必要な情報。失敗時と同じ内容を再送する。 */
type PendingSave = {
  /** 保存先の会話 ID */
  conversationId: string;
  /** メッセージの役割 */
  role: Message['role'];
  /** メッセージ本文 */
  content: string;
  /** ツール呼び出し情報等の付随メタデータ */
  metadata: Message['metadata'];
  /** 再試行で保存に成功した後に続ける処理（user なら応答生成、初回の assistant ならタイトル生成） */
  onSaved?: () => void;
  /** 再生成した応答なら true。新規保存（POST）ではなく、同じ ID の旧応答の置き換え（PUT）で保存する */
  replace?: boolean;
};

/**
 * メッセージを会話に永続化する（API 経由で保存）。
 *
 * 表示中の ID をそのまま DB の ID として送り、画面と DB の ID を揃える（再生成で置き換える
 * 対象を特定するため。#9）。再生成した応答は同じ ID の旧応答を PUT で置き換える。
 *
 * `fetch()` は HTTP 4xx/5xx では reject しないため、`response.ok` を検証して
 * 失敗を例外に変換する（検証しないと保存失敗が成功扱いになる）。
 *
 * @param messageId - 表示中のメッセージ ID（DB の ID になる）
 * @param payload - 保存内容（{@link PendingSave}）。`replace` なら置き換えで保存する
 * @throws {Error} 保存 API がエラーを返した、または通信に失敗した場合
 */
async function saveMessage(
  messageId: string,
  payload: PendingSave
): Promise<void> {
  const { conversationId, role, content, metadata, replace } = payload;
  const res = replace
    ? await fetch(
        `/api/conversations/${conversationId}/messages/${messageId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, metadata }),
        }
      )
    : await fetch(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: messageId, role, content, metadata }),
      });
  // 409 は同じ ID のメッセージが保存済み。前回の保存はサーバーに届いていて、
  // 応答だけが失われた（再試行で起こりうる）ものとして成功扱いにする
  if (!replace && res.status === 409) return;
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      data.error || `メッセージの保存に失敗しました (${res.status})`
    );
  }
}

/**
 * チャットのメッセージ状態と送受信ロジックを管理するフック。
 *
 * メッセージ送信時は user メッセージの保存を待ってから `/api/chat` へストリーミング
 * 要求を行い、NDJSON（エージェントモード）とプレーンテキスト（通常モード）の両方式を
 * 扱う。システムプロンプトは会話の役割とエージェントのプリセットを連結して送る。
 * 会話 ID が未指定なら役割付きで新規会話を作成し、初回応答の保存後にタイトル自動生成を
 * 要求する。保存に失敗したメッセージは `saveState` を付けて表示に残し、
 * `retrySave` で同じ内容を再送できる（user の保存失敗時は LLM を呼ばない）。
 * `stopGeneration` で生成を止めると、届いた分までの本文を `metadata.interrupted` 付きで
 * 保存する（本文が空なら応答を残さない）。中断は内部の `AbortController` で扱う。
 * `regenerate` は最後の応答を同じ質問で作り直し、生成し終えてから旧応答を置き換える
 * （失敗・本文が空のまま停止した場合は旧応答に戻し、DB には触れない）。
 *
 * @param options - フックの設定（{@link UseChatOptions}）。会話 ID・モデル・
 *   エージェント有効化・会話の役割・エージェントのプリセットと、会話作成／タイトル生成完了時の
 *   コールバックを含む。各フィールドの意味は {@link UseChatOptions} を参照。
 * @returns チャット状態と操作関数。`messages` は現在のメッセージ一覧、`isLoading` は
 *   送信・応答生成中フラグ、`error` は直近のエラーメッセージ（無ければ `null`）、
 *   `activeToolCall` は実行中のツール呼び出し（無ければ `null`）、`sendMessage` は
 *   本文を送信して応答をストリーム受信する関数、`stopGeneration` は生成中の応答を
 *   止める関数、`regenerate` は最後の応答を ID 指定で再生成する関数、`retrySave` は保存に失敗した
 *   メッセージを ID 指定で再送する関数、`clearMessages` はメッセージ・エラー・
 *   実行中ツールを初期化する関数、`loadMessages` は指定会話のメッセージを読み込む関数
 */
export function useChat({
  conversationId,
  model,
  enableTools = false,
  systemPrompt = '',
  agentPrompt = '',
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
  // 保存に失敗したメッセージ ID → 再送内容。表示用の state とは分け、再試行時に参照する
  const pendingSavesRef = useRef(new Map<string, PendingSave>());

  const setSaveState = useCallback(
    (messageId: string, saveState: MessageSaveState | undefined) => {
      setMessages((prev) =>
        prev.map((msg) => (msg.id === messageId ? { ...msg, saveState } : msg))
      );
    },
    []
  );

  /**
   * メッセージを保存し、結果を表示状態へ反映する。失敗時は再送内容を保持する。
   *
   * @param messageId - 表示中のメッセージ ID
   * @param payload - 保存内容
   * @returns 保存に成功したら true
   */
  const persist = useCallback(
    async (messageId: string, payload: PendingSave): Promise<boolean> => {
      try {
        await saveMessage(messageId, payload);
        pendingSavesRef.current.delete(messageId);
        setSaveState(messageId, undefined);
        return true;
      } catch (err) {
        console.error('Failed to save message:', err);
        pendingSavesRef.current.set(messageId, payload);
        setSaveState(messageId, 'failed');
        return false;
      }
    },
    [setSaveState]
  );

  const requestTitleGeneration = useCallback(
    (convId: string, firstMessage: string) => {
      fetch(`/api/conversations/${convId}/generate-title`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: firstMessage, model }),
      })
        .then(() => onTitleGenerated?.())
        .catch(console.error);
    },
    [model, onTitleGenerated]
  );

  const loadMessages = useCallback(async (convId: string) => {
    pendingSavesRef.current.clear();
    try {
      const res = await fetch(`/api/conversations/${convId}/messages`);
      if (!res.ok) return;
      const data = await res.json();
      setMessages(
        data.messages.map(
          (msg: {
            id: string;
            role: Message['role'];
            content: string;
            // DB の JSON 列は任意の値を持てるため、型を信用せず検証してから使う
            metadata?: unknown;
            createdAt: string;
          }) => ({
            ...msg,
            metadata: parseMessageMetadata(msg.metadata),
            createdAt: new Date(msg.createdAt),
          })
        )
      );
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  }, []);

  /**
   * 保存済みの user メッセージに対する応答を生成し、assistant メッセージとして保存する。
   *
   * @param activeConversationId - 応答を保存する会話 ID
   * @param content - 応答対象の user メッセージ本文
   * @param conversationHistory - この user メッセージより前の会話履歴
   * @param isFirstExchange - 会話の最初のやり取りか（true なら保存後にタイトルを生成する）
   * @param replacing - 再生成で置き換える旧応答。省略時は新しい応答として末尾に追加する。
   *   指定時は旧応答と同じ ID・同じ位置で生成し、保存は置き換え（PUT）で行う
   */
  const generateResponse = useCallback(
    async (
      activeConversationId: string,
      content: string,
      conversationHistory: HistoryEntry[],
      isFirstExchange: boolean,
      replacing?: Message
    ) => {
      setError(null);
      setIsLoading(true);
      setActiveToolCall(null);

      // 再生成では旧応答の ID を引き継ぐ（DB 上の旧応答を同じ ID で置き換えるため）
      const aiMessageId = replacing?.id ?? crypto.randomUUID();
      const aiMessage: Message = {
        id: aiMessageId,
        role: 'assistant',
        content: '',
        createdAt: new Date(),
      };
      setMessages((prev) =>
        replacing
          ? prev.map((msg) => (msg.id === aiMessageId ? aiMessage : msg))
          : [...prev, aiMessage]
      );

      // 応答を残さずに終わるとき（エラー・本文が空のままの停止・完了）に表示を戻す。
      // 再生成なら旧応答を元の位置に戻す（DB は書き換えていないため旧応答のまま）
      const discardResponse = () =>
        setMessages((prev) =>
          replacing
            ? prev.map((msg) => (msg.id === aiMessageId ? replacing : msg))
            : prev.filter((msg) => msg.id !== aiMessageId)
        );

      abortControllerRef.current = new AbortController();

      let fullAiContent = '';
      let thinkingText = '';
      // done イベントで届く実行統計。表示と保存の両方に使う
      let agentRounds: number | undefined;
      let agentDurationMs: number | undefined;
      const toolCallRecords: ToolCallInfo[] = [];
      // tool_call_start で受け取った arguments を tool_call_result まで保持する
      // 同名ツールが複数回呼ばれる場合に備え、FIFO キューで管理
      const pendingToolArgs = new Map<string, Array<Record<string, unknown>>>();

      /**
       * 届いた応答を保存し、最初のやり取りならタイトルを生成する。
       *
       * @param interrupted - ユーザーが停止した応答か（中断マーク付きで保存する）
       */
      const saveResponse = async (interrupted: boolean) => {
        if (!fullAiContent) {
          // 本文の無い応答は保存しない。再生成なら空の応答で置き換えず、旧応答に戻す
          if (replacing) discardResponse();
          return;
        }
        const generateTitle = isFirstExchange
          ? () => requestTitleGeneration(activeConversationId, content)
          : undefined;
        // タイトル生成は応答の保存成功後に限る（未保存のまま完了扱いへ進めない）。
        // 失敗時は再試行で保存できた時点で onSaved として実行する
        const saved = await persist(aiMessageId, {
          conversationId: activeConversationId,
          role: 'assistant',
          content: fullAiContent,
          // 表示中の metadata と同じ内容を保存する。ツールを使わず思考だけした応答も残す（#94）
          metadata: buildMessageMetadata({
            toolCalls: toolCallRecords,
            thinkingText,
            agentRounds,
            agentDurationMs,
            interrupted,
          }),
          onSaved: generateTitle,
          replace: replacing !== undefined,
        });
        if (saved) generateTitle?.();
      };

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: content,
            conversationHistory,
            model,
            enableTools,
            // 役割は送信のたびに今の値を送る。途中で変えた役割は以降の送信から効く
            systemPrompt:
              buildSystemPrompt(systemPrompt, agentPrompt) || undefined,
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
                  // thinking イベントは思考のブロック（ラウンドごと）単位で届く。
                  // 区切らずに連結すると前のブロックの文末に次の文頭がくっつくため、空行で区切る
                  thinkingText += (thinkingText ? '\n\n' : '') + event.content;
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === aiMessageId
                        ? {
                            ...msg,
                            metadata: { ...msg.metadata, thinkingText },
                          }
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
                  setActiveToolCall({
                    name: event.name,
                    arguments: event.arguments,
                  });
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
                    summary: event.summary,
                    isEmpty: event.isEmpty,
                    durationMs: 0,
                  };
                  toolCallRecords.push(record);
                  // 最後のツール呼び出しレコードを結果で更新
                  setMessages((prev) =>
                    prev.map((msg) => {
                      if (msg.id !== aiMessageId) return msg;
                      const toolCalls = [...(msg.metadata?.toolCalls ?? [])];
                      const idx = toolCalls
                        .map((t) => t.name)
                        .lastIndexOf(event.name);
                      if (idx >= 0) {
                        toolCalls[idx] = {
                          ...toolCalls[idx],
                          result: event.result,
                          isError: event.isError,
                          summary: event.summary,
                          isEmpty: event.isEmpty,
                        };
                      }
                      return {
                        ...msg,
                        metadata: { ...msg.metadata, toolCalls },
                      };
                    })
                  );
                } else if (event.type === 'done') {
                  // done イベントで metadata（toolCalls・統計）を最終確定
                  if (event.metadata?.toolCalls) {
                    toolCallRecords.length = 0;
                    toolCallRecords.push(...event.metadata.toolCalls);
                  }
                  agentRounds = event.metadata?.agentRounds;
                  agentDurationMs = event.metadata?.agentDurationMs;
                  // 保存時と同じ関数で組み立て、表示と DB の内容を揃える（#94）
                  const finalMetadata = buildMessageMetadata({
                    toolCalls: [...toolCallRecords],
                    thinkingText,
                    agentRounds,
                    agentDurationMs,
                  });
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === aiMessageId
                        ? { ...msg, metadata: finalMetadata }
                        : msg
                    )
                  );
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

        await saveResponse(false);
      } catch (err) {
        // 停止（stopGeneration）による中断。エラーにせず、届いた分までを応答として残す（#8）
        if (err instanceof DOMException && err.name === 'AbortError') {
          if (!fullAiContent) {
            // 本文が 1 文字も届く前に止めた。空の応答は残さない
            discardResponse();
            return;
          }
          // 停止までに届いた思考過程・ツール結果も含め、中断マーク付きで表示する
          const interruptedMetadata = buildMessageMetadata({
            toolCalls: [...toolCallRecords],
            thinkingText,
            agentRounds,
            agentDurationMs,
            interrupted: true,
          });
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === aiMessageId
                ? { ...msg, metadata: interruptedMetadata }
                : msg
            )
          );
          await saveResponse(true);
          return;
        }
        setError(
          err instanceof Error ? err.message : '不明なエラーが発生しました'
        );
        discardResponse();
      } finally {
        setIsLoading(false);
        setActiveToolCall(null);
        abortControllerRef.current = null;
      }
    },
    [
      model,
      enableTools,
      systemPrompt,
      agentPrompt,
      persist,
      requestTitleGeneration,
    ]
  );

  const sendMessage = useCallback(
    async (content: string) => {
      setError(null);
      setIsLoading(true);
      setActiveToolCall(null);

      // 送信に失敗したまま新しいメッセージが送られた場合、未送信の user メッセージは
      // 再送の対象外とし破棄する（LLM にも DB にも届いていないため履歴の整合は崩れない）
      const unsentIds = new Set(
        messages
          .filter((msg) => msg.role === 'user' && msg.saveState)
          .map((msg) => msg.id)
      );
      unsentIds.forEach((id) => pendingSavesRef.current.delete(id));
      const visibleMessages = messages.filter((msg) => !unsentIds.has(msg.id));

      let activeConversationId: string = conversationId || '';

      if (!activeConversationId) {
        try {
          const res = await fetch('/api/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // API 側の上限（MAX_TITLE_LENGTH）と同じ値で切り詰める。
            // ここがずれると会話作成が 400 になるため定数を共有する。
            // 最初の送信の前に選んだ役割も、会話と同時に保存する
            body: JSON.stringify({
              title: content.slice(0, MAX_TITLE_LENGTH),
              systemPrompt: systemPrompt || null,
            }),
          });
          if (!res.ok) throw new Error('会話の作成に失敗しました');
          const conv = await res.json();
          activeConversationId = conv.id;
          onConversationCreated?.(conv.id);
        } catch (err) {
          setError(
            err instanceof Error ? err.message : '会話の作成に失敗しました'
          );
          setIsLoading(false);
          return;
        }
      }

      const conversationHistory = toConversationHistory(visibleMessages);
      // 保存済みのメッセージが 1 件も無ければ最初のやり取り（タイトル生成の対象）
      const isFirstExchange = !visibleMessages.some((msg) => !msg.saveState);

      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        createdAt: new Date(),
      };
      setMessages((prev) => [
        ...prev.filter((msg) => !unsentIds.has(msg.id)),
        userMessage,
      ]);

      // user メッセージの保存を待ってから LLM を呼ぶ。先に呼ぶと、保存に失敗した
      // 場合に DB 上で質問の無い回答だけが残る
      const saved = await persist(userMessage.id, {
        conversationId: activeConversationId,
        role: 'user',
        content,
        metadata: null,
        onSaved: () =>
          generateResponse(
            activeConversationId,
            content,
            conversationHistory,
            isFirstExchange
          ),
      });
      if (!saved) {
        setIsLoading(false);
        return;
      }

      await generateResponse(
        activeConversationId,
        content,
        conversationHistory,
        isFirstExchange
      );
    },
    [
      conversationId,
      messages,
      systemPrompt,
      onConversationCreated,
      persist,
      generateResponse,
    ]
  );

  const regenerate = useCallback(
    async (messageId: string) => {
      if (!conversationId || isLoading) return;
      const found = findRegenerateTarget(messages, messageId);
      if (!found) return;
      // 最初のやり取りでもタイトルは生成済みのため作り直さない
      await generateResponse(
        conversationId,
        found.prompt,
        found.history,
        false,
        found.target
      );
    },
    [conversationId, isLoading, messages, generateResponse]
  );

  const retrySave = useCallback(
    async (messageId: string) => {
      const pending = pendingSavesRef.current.get(messageId);
      if (!pending) return;
      setSaveState(messageId, 'retrying');
      const saved = await persist(messageId, pending);
      if (saved) pending.onSaved?.();
    },
    [persist, setSaveState]
  );

  // 生成中の応答を止める。生成中でなければ何もしない（送信直後の保存待ちの間など）
  const stopGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const clearMessages = useCallback(() => {
    pendingSavesRef.current.clear();
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
    stopGeneration,
    regenerate,
    retrySave,
    clearMessages,
    loadMessages,
  };
}
