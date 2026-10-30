'use client';

import { useState, useCallback, useRef } from 'react';
import type { ToolCallInfo } from '@/types/agent/tool-call';
import type {
  HistoryEntry,
  Message,
  MessageImage,
  MessageSaveState,
} from '@/types/chat/message';
import type { PreparedImage } from '@/types/chat/attachment';
import type { AgentStreamEvent } from '@/lib/agent/tools/types';
import { MAX_TITLE_LENGTH } from '@/lib/shared/validation';
import { toConversationHistory } from '@/lib/chat/conversation-history';
import { findRegenerateTarget } from '@/lib/chat/regenerate';
import { buildSystemPrompt } from '@/lib/chat/system-prompt';
import {
  finishToolCall,
  startToolCall,
  updateMessageToolCalls,
  updateToolCallStatus,
} from '@/lib/chat/tool-call-progress';
import {
  restoreScreenshotData,
  screenshotAttachments,
  withoutScreenshotData,
} from '@/lib/chat/tool-screenshots';
import {
  buildMessageMetadata,
  parseMessageMetadata,
} from '@/lib/chat/message-metadata';
import type { ChatState, ChatStates } from '@/lib/chat/chat-state';
import {
  NEW_CONVERSATION_KEY,
  EMPTY_CHAT,
  applyLoadedMessages,
  chatKey,
  generatingConversationIds,
  getChat,
  moveChat,
  removeChat,
  retainChats,
  updateChat,
} from '@/lib/chat/chat-state';

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
  /**
   * 画像。user は添付した画像（#6）、assistant はブラウザのツールが撮った画面（#200）。再試行でも同じ ID・中身を送り直す
   */
  attachments?: Pick<PreparedImage, 'id' | 'data' | 'width' | 'height'>[];
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
  const { conversationId, role, content, metadata, replace, attachments } =
    payload;
  const res = replace
    ? await fetch(
        `/api/conversations/${conversationId}/messages/${messageId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, metadata, attachments }),
        }
      )
    : await fetch(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: messageId,
          role,
          content,
          metadata,
          attachments,
        }),
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
 * 状態（メッセージ・生成中・エラー・実行中ツール）は会話ごとに持ち、返す値は表示中の会話のもの
 * （#147）。生成中に会話を切り替えても、応答は送信した会話に届き続ける。停止は表示中の会話だけに効く。
 *
 * @param options - フックの設定（{@link UseChatOptions}）。会話 ID・モデル・
 *   エージェント有効化・会話の役割・エージェントのプリセットと、会話作成／タイトル生成完了時の
 *   コールバックを含む。各フィールドの意味は {@link UseChatOptions} を参照。
 * @returns 表示中の会話のチャット状態と操作関数。`messages` はメッセージ一覧、`isLoading` は
 *   送信・応答生成中フラグ、`error` は直近のエラーメッセージ（無ければ `null`）、
 *   `activeToolCall` は実行中のツール呼び出し（無ければ `null`）、`pendingApprovals` は承認を待っている
 *   ツールの実行（#148 Phase A2）、`respondToApproval` はそれに許可か拒否かを返す関数、`generatingConversationIds` は
 *   応答を生成中の会話 ID の一覧（表示中でない会話も含む）、`sendMessage` は
 *   本文と添付画像（#6。user メッセージと同じトランザクションで保存し、ID で LLM へ渡す）を送信して
 *   応答をストリーム受信する関数、`stopGeneration` は表示中の会話の生成中の応答を
 *   止める関数、`regenerate` は最後の応答を ID 指定で再生成する関数、`retrySave` は保存に失敗した
 *   メッセージを ID 指定で再送する関数、`clearMessages` は新規会話の画面の状態を初期化する関数、
 *   `loadMessages` は指定会話のメッセージを読み込む関数、`discardConversation` は削除した会話の
 *   生成を止めて状態を捨てる関数（応答は保存しない）
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
  const [chats, setChats] = useState<ChatStates>({});
  const currentKey = chatKey(conversationId);
  const { messages, isLoading, error, activeToolCall, pendingApprovals } =
    getChat(chats, currentKey);
  // 会話 ID → 生成中の応答の AbortController。停止は表示中の会話のものだけを中断する
  const abortControllersRef = useRef(new Map<string, AbortController>());
  // 保存に失敗したメッセージ ID → 再送内容。表示用の state とは分け、再試行時に参照する
  const pendingSavesRef = useRef(new Map<string, PendingSave>());
  // 削除した会話の ID。裏で続いていた生成の後始末が、消した会話の状態を作り直さないようにする
  const deletedIdsRef = useRef(new Set<string>());

  /**
   * 1 つの会話の状態を更新する。削除した会話は更新しない。
   *
   * @param key - 更新する会話のキー
   * @param update - 今の状態から新しい状態を作る関数
   */
  const updateChatOf = useCallback(
    (key: string, update: (chat: ChatState) => ChatState) => {
      if (deletedIdsRef.current.has(key)) return;
      setChats((prev) => updateChat(prev, key, update));
    },
    []
  );

  /**
   * 1 つの会話の状態の一部を差し替える。
   *
   * @param key - 更新する会話のキー
   * @param patch - 差し替える項目
   */
  const patchChat = useCallback(
    (key: string, patch: Partial<ChatState>) =>
      updateChatOf(key, (chat) => ({ ...chat, ...patch })),
    [updateChatOf]
  );

  /**
   * 1 つの会話のメッセージ一覧を更新する。
   *
   * @param key - 更新する会話のキー
   * @param update - 今の一覧から新しい一覧を作る関数
   */
  const setMessagesOf = useCallback(
    (key: string, update: (messages: Message[]) => Message[]) =>
      updateChatOf(key, (chat) => ({
        ...chat,
        messages: update(chat.messages),
      })),
    [updateChatOf]
  );

  /**
   * 1 つの会話の、1 つのメッセージのツール呼び出しの記録を更新する（#192）。
   *
   * @param key - 更新する会話のキー
   * @param messageId - 対象のメッセージ ID
   * @param update - 今の記録から新しい記録を作る関数
   */
  const updateToolCallsOf = useCallback(
    (
      key: string,
      messageId: string,
      update: (toolCalls: ToolCallInfo[]) => ToolCallInfo[]
    ) =>
      setMessagesOf(key, (prev) =>
        updateMessageToolCalls(prev, messageId, update)
      ),
    [setMessagesOf]
  );

  const setSaveState = useCallback(
    (
      convId: string,
      messageId: string,
      saveState: MessageSaveState | undefined
    ) => {
      setMessagesOf(convId, (prev) =>
        prev.map((msg) => (msg.id === messageId ? { ...msg, saveState } : msg))
      );
    },
    [setMessagesOf]
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
        setSaveState(payload.conversationId, messageId, undefined);
        return true;
      } catch (err) {
        console.error('Failed to save message:', err);
        // 削除した会話への保存は再送しても届かないため、再試行の対象にしない
        if (!deletedIdsRef.current.has(payload.conversationId)) {
          pendingSavesRef.current.set(messageId, payload);
        }
        setSaveState(payload.conversationId, messageId, 'failed');
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
    // 開いた会話と、DB から読み直すと失われるもの（生成中・保存失敗・エラー）を持つ会話だけを残す
    setChats((prev) => retainChats(prev, convId));
    // 生成中の会話は手元の一覧が最新。読み直さず、途中までの応答と続きをそのまま表示する
    if (abortControllersRef.current.has(convId)) return;
    try {
      const res = await fetch(`/api/conversations/${convId}/messages`);
      if (!res.ok) return;
      const data = await res.json();
      const loaded: Message[] = data.messages.map(
        (msg: {
          id: string;
          role: Message['role'];
          content: string;
          // DB の JSON 列は任意の値を持てるため、型を信用せず検証してから使う
          metadata?: unknown;
          createdAt: string;
          attachments?: Omit<MessageImage, 'src'>[];
        }) => {
          const { attachments = [], ...rest } = msg;
          return {
            ...rest,
            metadata: parseMessageMetadata(msg.metadata),
            createdAt: new Date(msg.createdAt),
            // 画像の中身は一覧に含まれないため、取得 API の URL で表示する（#6）。
            // assistant の画像はツールのスクリーンショット（#200）で、記録（metadata）から ID で表示するため、添付画像にしない
            // （会話の履歴の imageIds に入れると、/api/chat が assistant の画像として断る）
            ...(msg.role === 'user' &&
              attachments.length > 0 && {
                images: attachments.map(({ id, width, height }) => ({
                  id,
                  src: `/api/attachments/${id}`,
                  width,
                  height,
                })),
              }),
          };
        }
      );
      // 読んでいる間に生成が始まった・保存に失敗した会話は、手元の一覧を残す
      setChats((prev) => applyLoadedMessages(prev, convId, loaded));
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  }, []);

  /**
   * 保存済みの user メッセージに対する応答を生成し、assistant メッセージとして保存する。
   *
   * @param activeConversationId - 応答を保存する会話 ID
   * @param content - 応答対象の user メッセージ本文
   * @param imageIds - 応答対象の user メッセージの添付画像の ID（#6。無ければ空配列）
   * @param conversationHistory - この user メッセージより前の会話履歴
   * @param isFirstExchange - 会話の最初のやり取りか（true なら保存後にタイトルを生成する）
   * @param replacing - 再生成で置き換える旧応答。省略時は新しい応答として末尾に追加する。
   *   指定時は旧応答と同じ ID・同じ位置で生成し、保存は置き換え（PUT）で行う
   */
  const generateResponse = useCallback(
    async (
      activeConversationId: string,
      content: string,
      imageIds: string[],
      conversationHistory: HistoryEntry[],
      isFirstExchange: boolean,
      replacing?: Message
    ) => {
      // 状態は送信した会話のものを更新する。表示中の会話が切り替わっても応答が届き続ける（#147）
      const convId = activeConversationId;
      patchChat(convId, { error: null, isLoading: true, activeToolCall: null });

      // 再生成では旧応答の ID を引き継ぐ（DB 上の旧応答を同じ ID で置き換えるため）
      const aiMessageId = replacing?.id ?? crypto.randomUUID();
      const aiMessage: Message = {
        id: aiMessageId,
        role: 'assistant',
        content: '',
        createdAt: new Date(),
      };
      setMessagesOf(convId, (prev) =>
        replacing
          ? prev.map((msg) => (msg.id === aiMessageId ? aiMessage : msg))
          : [...prev, aiMessage]
      );

      // 応答を残さずに終わるとき（エラー・本文が空のままの停止・完了）に表示を戻す。
      // 再生成なら旧応答を元の位置に戻す（DB は書き換えていないため旧応答のまま）
      const discardResponse = () =>
        setMessagesOf(convId, (prev) =>
          replacing
            ? prev.map((msg) => (msg.id === aiMessageId ? replacing : msg))
            : prev.filter((msg) => msg.id !== aiMessageId)
        );

      const controller = new AbortController();
      abortControllersRef.current.set(convId, controller);

      let fullAiContent = '';
      let thinkingText = '';
      // done イベントで届く実行統計。表示と保存の両方に使う
      let agentRounds: number | undefined;
      let agentDurationMs: number | undefined;
      const toolCallRecords: ToolCallInfo[] = [];
      // tool_call_result で届いたスクリーンショットの中身（ID → Base64。#200）。done の記録（中身なし）に戻し、保存で送る
      const screenshotData = new Map<string, string>();
      // tool_call_start で受け取った arguments と本文の位置（contentOffset。#186）を tool_call_result まで保持する
      // 同名ツールが複数回呼ばれる場合に備え、FIFO キューで管理
      const pendingToolArgs = new Map<
        string,
        Array<Pick<ToolCallInfo, 'arguments' | 'contentOffset'>>
      >();

      /**
       * 届いた応答を保存し、最初のやり取りならタイトルを生成する。
       *
       * @param interrupted - ユーザーが停止した応答か（中断マーク付きで保存する）
       */
      const saveResponse = async (interrupted: boolean) => {
        // 生成中に削除された会話には保存しない（保存先が無く、行き場のない保存失敗が残る）
        if (deletedIdsRef.current.has(convId)) return;
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
          // 表示中の metadata と同じ内容を保存する。ツールを使わず思考だけした応答も残す（#94）。
          // スクリーンショットの中身は metadata から外し、添付画像として送る（#200）
          metadata: buildMessageMetadata({
            toolCalls: withoutScreenshotData(toolCallRecords),
            thinkingText,
            agentRounds,
            agentDurationMs,
            interrupted,
          }),
          onSaved: generateTitle,
          replace: replacing !== undefined,
          attachments: screenshotAttachments(toolCallRecords),
        });
        if (saved) generateTitle?.();
      };

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: content,
            imageIds,
            conversationHistory,
            model,
            enableTools,
            // 役割は送信のたびに今の値を送る。途中で変えた役割は以降の送信から効く
            systemPrompt:
              buildSystemPrompt(systemPrompt, agentPrompt) || undefined,
          }),
          signal: controller.signal,
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
                  setMessagesOf(convId, (prev) =>
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
                  setMessagesOf(convId, (prev) =>
                    prev.map((msg) =>
                      msg.id === aiMessageId
                        ? { ...msg, content: msg.content + event.content }
                        : msg
                    )
                  );
                } else if (event.type === 'tool_call_start') {
                  patchChat(convId, {
                    activeToolCall: {
                      name: event.name,
                      arguments: event.arguments,
                    },
                  });
                  // arguments と本文の位置を pending キューに積む
                  const queue = pendingToolArgs.get(event.name) ?? [];
                  queue.push({
                    arguments: event.arguments,
                    contentOffset: event.contentOffset,
                  });
                  pendingToolArgs.set(event.name, queue);
                  // ツール実行中を UI に反映（結果が届くまで「実行中」の仮の記録。#192）
                  updateToolCallsOf(convId, aiMessageId, (toolCalls) =>
                    startToolCall(toolCalls, {
                      name: event.name,
                      arguments: event.arguments,
                      contentOffset: event.contentOffset,
                    })
                  );
                } else if (event.type === 'tool_approval_request') {
                  // 承認を待つ。承認カードを出し、利用者の許可・拒否は respondToApproval で返す（#148 Phase A2）
                  const { approvalId, name, preview } = event;
                  updateChatOf(convId, (chat) => ({
                    ...chat,
                    pendingApprovals: [
                      ...chat.pendingApprovals,
                      { approvalId, name, preview, messageId: aiMessageId },
                    ],
                  }));
                  // 仮の記録を「承認待ち」にする（許可していないのに ✅ に見えないように。#192）
                  updateToolCallsOf(convId, aiMessageId, (toolCalls) =>
                    updateToolCallStatus(
                      toolCalls,
                      name,
                      'running',
                      'awaiting-approval'
                    )
                  );
                } else if (event.type === 'tool_call_result') {
                  patchChat(convId, { activeToolCall: null });
                  if (event.approval) {
                    // 時間切れなど、画面から答えずに決着した承認のカードを消す（答えた分は respondToApproval で消してある）
                    updateChatOf(convId, (chat) => {
                      const index = chat.pendingApprovals.findIndex(
                        (request) => request.name === event.name
                      );
                      return index < 0
                        ? chat
                        : {
                            ...chat,
                            pendingApprovals: chat.pendingApprovals.filter(
                              (_, i) => i !== index
                            ),
                          };
                    });
                  }
                  // pending キューから先頭の arguments と本文の位置を取り出す（FIFO）
                  const argsQueue = pendingToolArgs.get(event.name) ?? [];
                  const started = argsQueue.shift();
                  if (argsQueue.length === 0) {
                    pendingToolArgs.delete(event.name);
                  } else {
                    pendingToolArgs.set(event.name, argsQueue);
                  }
                  const record: ToolCallInfo = {
                    name: event.name,
                    arguments: started?.arguments ?? {},
                    result: event.result,
                    isError: event.isError,
                    summary: event.summary,
                    isEmpty: event.isEmpty,
                    durationMs: 0,
                    contentOffset: started?.contentOffset,
                    approval: event.approval,
                    ...(event.screenshots && {
                      screenshots: event.screenshots,
                    }),
                  };
                  for (const shot of event.screenshots ?? []) {
                    if (shot.data) screenshotData.set(shot.id, shot.data);
                  }
                  toolCallRecords.push(record);
                  // 仮の記録を結果で置き換え、実行中・承認待ちの表示をやめる（#192）
                  updateToolCallsOf(convId, aiMessageId, (toolCalls) =>
                    finishToolCall(toolCalls, event.name, {
                      result: event.result,
                      isError: event.isError,
                      summary: event.summary,
                      isEmpty: event.isEmpty,
                      approval: event.approval,
                      ...(event.screenshots && {
                        screenshots: event.screenshots,
                      }),
                    })
                  );
                } else if (event.type === 'done') {
                  // done イベントで metadata（toolCalls・統計）を最終確定
                  if (event.metadata?.toolCalls) {
                    toolCallRecords.length = 0;
                    // done の記録はスクリーンショットの中身を持たないため、届いた中身を戻す（表示と保存に使う。#200）
                    toolCallRecords.push(
                      ...restoreScreenshotData(
                        event.metadata.toolCalls,
                        screenshotData
                      )
                    );
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
                  setMessagesOf(convId, (prev) =>
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
            setMessagesOf(convId, (prev) =>
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
          setMessagesOf(convId, (prev) =>
            prev.map((msg) =>
              msg.id === aiMessageId
                ? { ...msg, metadata: interruptedMetadata }
                : msg
            )
          );
          await saveResponse(true);
          return;
        }
        // エラーは送信した会話に出す。裏の会話のエラーが表示中の会話に出ないようにする
        patchChat(convId, {
          error:
            err instanceof Error ? err.message : '不明なエラーが発生しました',
        });
        discardResponse();
      } finally {
        // 応答が終われば、答えていない承認も決着している（サーバーは停止・切断で取り消す）
        patchChat(convId, {
          isLoading: false,
          activeToolCall: null,
          pendingApprovals: [],
        });
        if (abortControllersRef.current.get(convId) === controller) {
          abortControllersRef.current.delete(convId);
        }
      }
    },
    [
      model,
      enableTools,
      systemPrompt,
      agentPrompt,
      persist,
      requestTitleGeneration,
      patchChat,
      updateChatOf,
      setMessagesOf,
      updateToolCallsOf,
    ]
  );

  const sendMessage = useCallback(
    async (content: string, images: PreparedImage[] = []) => {
      patchChat(currentKey, {
        error: null,
        isLoading: true,
        activeToolCall: null,
      });

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
          // 新規会話の画面の状態（送信中であること等）を、作った会話へ引き継ぐ
          setChats((prev) => moveChat(prev, currentKey, conv.id));
          onConversationCreated?.(conv.id);
        } catch (err) {
          patchChat(currentKey, {
            error:
              err instanceof Error ? err.message : '会話の作成に失敗しました',
            isLoading: false,
          });
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
        // 送ったばかりの画像は手元の data: URI で表示する（読み直すまで取得 API を呼ばない）
        ...(images.length > 0 && {
          images: images.map(({ id, src, width, height }) => ({
            id,
            src,
            width,
            height,
          })),
        }),
      };
      const imageIds = images.map((image) => image.id);
      setMessagesOf(activeConversationId, (prev) => [
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
        ...(images.length > 0 && {
          attachments: images.map(({ id, data, width, height }) => ({
            id,
            data,
            width,
            height,
          })),
        }),
        onSaved: () =>
          generateResponse(
            activeConversationId,
            content,
            imageIds,
            conversationHistory,
            isFirstExchange
          ),
      });
      if (!saved) {
        patchChat(activeConversationId, { isLoading: false });
        return;
      }

      await generateResponse(
        activeConversationId,
        content,
        imageIds,
        conversationHistory,
        isFirstExchange
      );
    },
    [
      conversationId,
      currentKey,
      messages,
      systemPrompt,
      onConversationCreated,
      persist,
      generateResponse,
      patchChat,
      setMessagesOf,
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
        found.imageIds,
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
      setSaveState(pending.conversationId, messageId, 'retrying');
      const saved = await persist(messageId, pending);
      if (saved) pending.onSaved?.();
    },
    [persist, setSaveState]
  );

  /**
   * 承認を待っているツールの実行に、許可か拒否かを返す（#148 Phase A2）。
   *
   * 承認カードはすぐに消し、承認の API に送る。API が失敗した（時間切れで決着済み等）ときはエラーを出す。
   * 結果はエージェントのストリームの `tool_call_result` で届く。
   *
   * @param approvalId - 承認 ID
   * @param approved - 許可なら true、拒否なら false
   */
  const respondToApproval = useCallback(
    async (approvalId: string, approved: boolean) => {
      const convId = currentKey;
      updateChatOf(convId, (chat) => {
        const request = chat.pendingApprovals.find(
          (pending) => pending.approvalId === approvalId
        );
        return {
          ...chat,
          pendingApprovals: chat.pendingApprovals.filter(
            (pending) => pending.approvalId !== approvalId
          ),
          // 答えたら「承認待ち」を「実行中」に戻す（拒否でも、結果が届くまでの間は実行中として出す。#192）
          messages: request
            ? updateMessageToolCalls(
                chat.messages,
                request.messageId,
                (toolCalls) =>
                  updateToolCallStatus(
                    toolCalls,
                    request.name,
                    'awaiting-approval',
                    'running'
                  )
              )
            : chat.messages,
        };
      });
      try {
        const res = await fetch(`/api/agent/approvals/${approvalId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approved }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(
            data.error || `承認を送れませんでした (${res.status})`
          );
        }
      } catch (err) {
        patchChat(convId, {
          error: err instanceof Error ? err.message : '承認を送れませんでした',
        });
      }
    },
    [currentKey, updateChatOf, patchChat]
  );

  // 表示中の会話の生成中の応答を止める。生成中でなければ何もしない（送信直後の保存待ちの間など）。
  // 裏で生成中の別の会話は止めない
  const stopGeneration = useCallback(() => {
    abortControllersRef.current.get(currentKey)?.abort();
  }, [currentKey]);

  // 新規会話の画面を空にする。裏で生成中の会話・保存に失敗したメッセージを持つ会話の状態は残す
  const clearMessages = useCallback(() => {
    setChats((prev) =>
      retainChats(
        updateChat(prev, NEW_CONVERSATION_KEY, () => EMPTY_CHAT),
        NEW_CONVERSATION_KEY
      )
    );
  }, []);

  /**
   * 削除した会話の生成を止め、状態と再送内容を捨てる。止めた応答は保存しない。
   *
   * 会話の削除に成功してから呼ぶ（失敗したのに呼ぶと、残った会話の生成まで止めてしまう）。
   *
   * @param convId - 削除した会話の ID
   */
  const discardConversation = useCallback((convId: string) => {
    // 中断より先に記録する。中断で走る後始末（停止した応答の保存）が、削除済みと判断できるように
    deletedIdsRef.current.add(convId);
    abortControllersRef.current.get(convId)?.abort();
    abortControllersRef.current.delete(convId);
    for (const [messageId, pending] of pendingSavesRef.current) {
      if (pending.conversationId === convId) {
        pendingSavesRef.current.delete(messageId);
      }
    }
    setChats((prev) => removeChat(prev, convId));
  }, []);

  return {
    messages,
    isLoading,
    error,
    activeToolCall,
    pendingApprovals,
    generatingConversationIds: generatingConversationIds(chats),
    sendMessage,
    stopGeneration,
    regenerate,
    retrySave,
    respondToApproval,
    clearMessages,
    loadMessages,
    discardConversation,
  };
}
