/**
 * 分岐した会話の分岐元（#29）。会話一覧の API が、分岐した応答から元の会話をたどって返す。
 */
export type ConversationForkSource = {
  /** 分岐元の会話の ID */
  conversationId: string;
  /** 分岐した応答（assistant のメッセージ）の ID。リンクを押すとここへ移る */
  messageId: string;
  /** 分岐元の会話のタイトル（ヘッダーのリンクに出す） */
  title: string;
};

/**
 * 会話（メッセージのまとまり）のメタ情報。サイドバーの履歴表示に用いる。
 */
export type Conversation = {
  /** 会話の一意 ID（UUID） */
  id: string;
  /** 会話タイトル（LLM で自動生成されうる） */
  title: string;
  /** 会話の役割（システムプロンプト）。役割なしは `null`（#10） */
  systemPrompt: string | null;
  /** 作成日時（API から ISO 文字列で受け取る） */
  createdAt: string;
  /** 最終更新日時（API から ISO 文字列で受け取る） */
  updatedAt: string;
  /** 分岐元（#29）。分岐していない会話・分岐元が消えた会話は `null` */
  forkedFrom: ConversationForkSource | null;
};

/**
 * 会話検索（`GET /api/conversations/search`。#11）の結果の 1 件。
 */
export type ConversationSearchResult = Pick<
  Conversation,
  'id' | 'title' | 'updatedAt'
> & {
  /**
   * 最初にキーワードが現れたメッセージの、一致箇所の前後の抜粋。
   * タイトルにしか一致しなかった会話では `null`
   */
  snippet: string | null;
};
