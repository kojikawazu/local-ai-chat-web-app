import type { Prisma } from '@/generated/prisma/client';
import type { ConversationForkSource } from '@/types/conversation/conversation';

/**
 * 会話を返す API（一覧・作成・役割の変更・分岐）で読む列。
 *
 * 分岐元（#29）は、分岐した応答から元の会話をたどって 1 回のクエリで引く。
 * 4 つの route で同じ形を返すため 1 か所に置く（役割の変更の応答で一覧の会話を差し替えるので、
 * 形がずれると分岐元のリンクが消える）。
 */
export const CONVERSATION_SELECT = {
  id: true,
  title: true,
  systemPrompt: true,
  createdAt: true,
  updatedAt: true,
  forkedFromMessage: {
    select: {
      id: true,
      conversation: { select: { id: true, title: true } },
    },
  },
} satisfies Prisma.ConversationSelect;

/** {@link CONVERSATION_SELECT} で読んだ会話の行。 */
type ConversationRow = Prisma.ConversationGetPayload<{
  select: typeof CONVERSATION_SELECT;
}>;

/** 会話を返す API の 1 件の形（`types/conversation/conversation.ts` の `Conversation` の、日時が `Date` のもの）。 */
export type ConversationResponse = Omit<
  ConversationRow,
  'forkedFromMessage'
> & {
  /** 分岐元（#29）。分岐していない・分岐元が消えた会話は `null` */
  forkedFrom: ConversationForkSource | null;
};

/**
 * DB の会話の行を、API が返す形に直す（分岐元の応答・会話を `forkedFrom` にまとめる）。
 *
 * @param row - {@link CONVERSATION_SELECT} で読んだ会話の行
 * @returns API が返す会話の 1 件
 */
export function toConversationResponse(
  row: ConversationRow
): ConversationResponse {
  const { forkedFromMessage, ...rest } = row;
  return {
    ...rest,
    forkedFrom: forkedFromMessage
      ? {
          conversationId: forkedFromMessage.conversation.id,
          messageId: forkedFromMessage.id,
          title: forkedFromMessage.conversation.title,
        }
      : null,
  };
}
