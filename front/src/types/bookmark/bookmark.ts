/**
 * ブックマークの一覧（`GET /api/bookmarks`。#30）の 1 件。
 *
 * API・一覧のフック・一覧の部品で共有する。日時は JSON で受け渡すため ISO 8601 の文字列。
 */
export type BookmarkListItem = {
  /** ブックマークの ID（UUID） */
  id: string;
  /** メモ。無ければ `null` */
  note: string | null;
  /** ブックマークを付けた日時（ISO 8601） */
  createdAt: string;
  /** ブックマークを付けた応答の ID。元の応答へ移るときの移る先 */
  messageId: string;
  /** 応答のある会話の ID。元の応答へ移るときに開く会話 */
  conversationId: string;
  /** 応答のある会話のタイトル */
  conversationTitle: string;
  /** 応答の抜粋（`buildBookmarkSnippet`） */
  snippet: string;
};

/** ブックマーク（`POST /api/bookmarks`・`PATCH /api/bookmarks/[id]` の応答。#30）。 */
export type Bookmark = {
  /** ブックマークの ID（UUID） */
  id: string;
  /** ブックマークを付けた応答の ID */
  messageId: string;
  /** メモ。無ければ `null` */
  note: string | null;
  /** 付けた日時（ISO 8601） */
  createdAt: string;
  /** メモを最後に書き換えた日時（ISO 8601） */
  updatedAt: string;
};
