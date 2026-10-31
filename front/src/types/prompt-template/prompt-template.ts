/**
 * 入力欄の `/` で呼び出すプロンプトのテンプレート（#28）。API の応答・フック・部品で共有する。
 */
export type PromptTemplate = {
  /** テンプレートの UUID */
  id: string;
  /** 表示名（候補・管理画面） */
  name: string;
  /** `/` の後ろに打つ名前（先頭の `/` は含めない。小文字） */
  shortcut: string;
  /** 入力欄に入れる本文（前後の空白・改行も書いたまま） */
  content: string;
  /** 作成日時（ISO 8601） */
  createdAt: string;
  /** 更新日時（ISO 8601） */
  updatedAt: string;
};
