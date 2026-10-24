import type { ToolCallInfo } from '@/types/agent/tool-call';
import type { Message } from '@/types/chat/message';

/**
 * 新規会話の画面（会話を作る前）の状態を置くキー。会話 ID は UUID のため衝突しない。
 */
export const NEW_CONVERSATION_KEY = 'new';

/** 実行中のツール呼び出し（結果が届く前に表示する分）。 */
export type ActiveToolCall = Pick<ToolCallInfo, 'name' | 'arguments'>;

/**
 * 1 つの会話のチャット状態。生成中に会話を切り替えても失われないよう、会話ごとに持つ（#147）。
 */
export type ChatState = {
  /** 表示するメッセージ一覧（古い順） */
  messages: Message[];
  /** 送信・応答の生成中か */
  isLoading: boolean;
  /** 直近のエラーメッセージ。無ければ `null` */
  error: string | null;
  /** 実行中のツール呼び出し。無ければ `null` */
  activeToolCall: ActiveToolCall | null;
};

/** 会話ごとのチャット状態。キーは会話 ID か {@link NEW_CONVERSATION_KEY}。 */
export type ChatStates = Record<string, ChatState>;

/** 状態を持たない会話の状態。参照を共有し、表示側の effect を無駄に走らせない。 */
export const EMPTY_CHAT: ChatState = {
  messages: [],
  isLoading: false,
  error: null,
  activeToolCall: null,
};

/**
 * 会話 ID から状態のキーを求める。
 *
 * @param conversationId - 会話 ID。会話を作る前は `null`
 * @returns 状態のキー
 */
export function chatKey(conversationId: string | null): string {
  return conversationId ?? NEW_CONVERSATION_KEY;
}

/**
 * 会話の状態を取り出す。
 *
 * @param chats - 会話ごとの状態
 * @param key - 状態のキー
 * @returns その会話の状態。持っていなければ {@link EMPTY_CHAT}
 */
export function getChat(chats: ChatStates, key: string): ChatState {
  return chats[key] ?? EMPTY_CHAT;
}

/**
 * 1 つの会話の状態を更新する。
 *
 * @param chats - 会話ごとの状態
 * @param key - 更新する会話のキー
 * @param update - 今の状態から新しい状態を作る関数（状態が無ければ {@link EMPTY_CHAT} を受け取る）
 * @returns 更新後の会話ごとの状態
 */
export function updateChat(
  chats: ChatStates,
  key: string,
  update: (chat: ChatState) => ChatState
): ChatStates {
  return { ...chats, [key]: update(getChat(chats, key)) };
}

/**
 * 会話の状態を別のキーへ移す。新規会話の画面で送信して会話ができたとき、送信中の状態を
 * 作った会話へ引き継ぐのに使う。
 *
 * @param chats - 会話ごとの状態
 * @param from - 移す元のキー
 * @param to - 移す先のキー
 * @returns 移した後の会話ごとの状態
 */
export function moveChat(
  chats: ChatStates,
  from: string,
  to: string
): ChatStates {
  const { [from]: chat, ...rest } = chats;
  return { ...rest, [to]: chat ?? EMPTY_CHAT };
}

/**
 * 会話の状態を捨てる。
 *
 * @param chats - 会話ごとの状態
 * @param key - 捨てる会話のキー
 * @returns 捨てた後の会話ごとの状態
 */
export function removeChat(chats: ChatStates, key: string): ChatStates {
  return Object.fromEntries(Object.entries(chats).filter(([k]) => k !== key));
}

/**
 * DB に無いメッセージ（保存に失敗して再試行待ち）を持つか。
 *
 * @param chat - 会話の状態
 * @returns 持っていれば true
 */
function hasUnsavedMessages(chat: ChatState): boolean {
  return chat.messages.some((msg) => msg.saveState);
}

/**
 * DB から読み直すと失われるものを持つか。生成中の応答・保存に失敗したメッセージ・
 * 裏で起きたエラーは DB に無いため、持っている間は状態を残す。
 *
 * @param chat - 会話の状態
 * @returns 持っていれば true
 */
function hasLocalOnlyState(chat: ChatState): boolean {
  return chat.isLoading || hasUnsavedMessages(chat) || chat.error !== null;
}

/**
 * 表示中の会話と、DB から読み直すと失われるものを持つ会話の状態だけを残す。
 * それ以外は開き直したときに DB から読めるため、捨ててメモリに溜めない。
 *
 * @param chats - 会話ごとの状態
 * @param currentKey - 表示中の会話のキー
 * @returns 残した会話ごとの状態
 */
export function retainChats(chats: ChatStates, currentKey: string): ChatStates {
  return Object.fromEntries(
    Object.entries(chats).filter(
      ([key, chat]) => key === currentKey || hasLocalOnlyState(chat)
    )
  );
}

/**
 * DB から読んだメッセージを会話の状態に反映する。
 *
 * 生成中・保存に失敗したメッセージがある会話は、手元の一覧の方が新しいため反映しない
 * （反映すると、生成中の応答や再試行待ちのメッセージが消える）。エラーは残す。
 *
 * @param chats - 会話ごとの状態
 * @param key - 読んだ会話のキー
 * @param messages - DB から読んだメッセージ
 * @returns 反映後の会話ごとの状態
 */
export function applyLoadedMessages(
  chats: ChatStates,
  key: string,
  messages: Message[]
): ChatStates {
  const chat = getChat(chats, key);
  if (chat.isLoading || hasUnsavedMessages(chat)) return chats;
  return { ...chats, [key]: { ...chat, messages } };
}

/**
 * 応答を生成中の会話の ID を求める（サイドバーの印に使う）。会話を作る前の状態は含めない。
 *
 * @param chats - 会話ごとの状態
 * @returns 生成中の会話 ID
 */
export function generatingConversationIds(chats: ChatStates): string[] {
  return Object.entries(chats)
    .filter(([key, chat]) => key !== NEW_CONVERSATION_KEY && chat.isLoading)
    .map(([key]) => key);
}
