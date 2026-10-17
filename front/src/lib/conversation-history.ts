import type { HistoryEntry, Message } from '@/types';
import { getMaxMessageLength, MAX_HISTORY_MESSAGES } from '@/lib/validation';

/**
 * 表示中のメッセージから LLM へ渡す会話履歴を組み立てる。
 *
 * 送信に失敗した user メッセージ（`saveState` 付き）は LLM に届いていないため除く。
 * 保存に失敗した assistant メッセージは LLM が実際に返した内容なので含める。
 *
 * `/api/chat` は履歴を件数・本文の長さで検証する（#95）。DB から復元した履歴は保存時に
 * 同じ上限で検証済みだが、保存上限を超えて保存に失敗した assistant 応答は画面に残るため、
 * ここで上限に収める。上限を超えたまま送ると 400 になり、その会話を続けられなくなる。
 * 件数は新しい方から {@link MAX_HISTORY_MESSAGES} 件を残し、本文は role 別の上限で切り詰める。
 *
 * @param messages - 表示中のメッセージ一覧（古い順）
 * @returns LLM へ渡す会話履歴（古い順）
 */
export function toConversationHistory(messages: Message[]): HistoryEntry[] {
  return messages
    .filter((msg) => !(msg.role === 'user' && msg.saveState))
    .slice(-MAX_HISTORY_MESSAGES)
    .map((msg) => ({
      role: msg.role,
      content: msg.content.slice(0, getMaxMessageLength(msg.role)),
    }));
}
