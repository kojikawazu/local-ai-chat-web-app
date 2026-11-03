import type { HistoryEntry, Message } from '@/types/chat/message';
import {
  getMaxMessageLength,
  MAX_HISTORY_MESSAGES,
} from '@/lib/shared/validation';

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
 * 添付画像のある user メッセージには、その ID（`imageIds`）を付ける。サーバーが DB から読んで LLM へ渡す（#6）。
 * 応答の途中で読まれた指示（#241）は、その応答の直前の user の発言の後ろに足す。
 *
 * @param messages - 表示中のメッセージ一覧（古い順）
 * @returns LLM へ渡す会話履歴（古い順）
 */
export function toConversationHistory(messages: Message[]): HistoryEntry[] {
  const sent = messages.filter(
    (msg) => !(msg.role === 'user' && msg.saveState)
  );
  return sent
    .map((msg, index) => ({
      msg,
      // 次の応答の途中で足した指示（#241）は、この user の発言の後ろに足す
      content: withInstructions(msg, sent[index + 1]),
    }))
    .slice(-MAX_HISTORY_MESSAGES)
    .map(({ msg, content }) => ({
      role: msg.role,
      content: content.slice(0, getMaxMessageLength(msg.role)),
      ...(msg.images &&
        msg.images.length > 0 && {
          imageIds: msg.images.map((image) => image.id),
        }),
    }));
}

/** 履歴で、user の発言の後ろに途中の指示を足すときの見出し（#241） */
const INSTRUCTIONS_HEADING = '（応答の途中で足した指示）';

/**
 * user の発言の本文に、続く応答の途中で読まれた指示（#241）を足す。
 *
 * 次の質問でモデルが前提を失わないよう、指示は「その応答への頼み方」として直前の user の発言に足す（assistant の本文に混ぜると、
 * モデルが自分の発言と取り違えるため）。読まれなかった指示は応答に効いていないため足さない。
 * 足した結果が上限を超えたら、切り詰め（呼び出し側）で指示の側が切れる（元の本文が先にある）。
 *
 * @param msg - 対象のメッセージ
 * @param next - 次のメッセージ（応答）
 * @returns 指示を足した本文。user でない・次の応答に読まれた指示が無ければ元の本文
 */
function withInstructions(msg: Message, next: Message | undefined): string {
  if (msg.role !== 'user' || next?.role !== 'assistant') return msg.content;
  const read = (next.metadata?.instructions ?? []).filter(
    (instruction) => instruction.contentOffset !== undefined
  );
  if (read.length === 0) return msg.content;
  const lines = read.map((instruction) => `- ${instruction.content}`);
  return `${msg.content}\n\n${INSTRUCTIONS_HEADING}\n${lines.join('\n')}`;
}
