import type { HistoryEntry, Message } from '@/types/chat/message';
import { toConversationHistory } from '@/lib/chat/conversation-history';

/** 応答を再生成するときに LLM へ送り直す内容（{@link findRegenerateTarget} の結果）。 */
export type RegenerateTarget = {
  /** 置き換える assistant の応答 */
  target: Message;
  /** 応答の元になった user メッセージの本文（これを送り直す） */
  prompt: string;
  /** その user メッセージの添付画像の ID（#6。画像付きの質問も画像ごと送り直す）。無ければ空配列 */
  imageIds: string[];
  /** その user メッセージより前の会話履歴（最初の送信時と同じ範囲） */
  history: HistoryEntry[];
};

/**
 * 指定した応答が再生成できるかを判定し、送り直す内容を組み立てる（#9）。
 *
 * 再生成できるのは、次の条件をすべて満たす応答だけ:
 * - 表示中の**最後**のメッセージで、role が assistant（途中の応答を作り直すと、後続のやり取りと食い違う）
 * - 保存に失敗していない（DB に無い応答は置き換えられない。先に再試行してもらう）
 * - 直前に保存済みの user メッセージがある（送り直す質問）
 *
 * @param messages - 表示中のメッセージ一覧（古い順）
 * @param messageId - 再生成する応答の ID
 * @returns 送り直す内容。再生成できない応答なら `null`
 */
export function findRegenerateTarget(
  messages: Message[],
  messageId: string
): RegenerateTarget | null {
  const targetIndex = messages.length - 1;
  const target = messages[targetIndex];
  if (!target || target.id !== messageId) return null;
  if (target.role !== 'assistant' || target.saveState) return null;

  const promptMessage = messages[targetIndex - 1];
  if (
    !promptMessage ||
    promptMessage.role !== 'user' ||
    promptMessage.saveState
  ) {
    return null;
  }

  return {
    target,
    prompt: promptMessage.content,
    imageIds: promptMessage.images?.map((image) => image.id) ?? [],
    history: toConversationHistory(messages.slice(0, targetIndex - 1)),
  };
}
