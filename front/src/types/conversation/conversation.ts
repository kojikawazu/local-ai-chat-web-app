/**
 * 会話（メッセージのまとまり）のメタ情報。サイドバーの履歴表示に用いる。
 */
export interface Conversation {
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
}

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
