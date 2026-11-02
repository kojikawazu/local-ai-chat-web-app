/**
 * 取り込んだドキュメントの一覧の 1 件（#17）。本文・埋め込みは含めない。
 *
 * `GET /api/knowledge/documents` の要素・取り込みと作り直しの応答の `document`。
 */
export type KnowledgeDocumentItem = {
  /** ドキュメントの UUID */
  id: string;
  /** ファイル名（同じ名前で取り込むと置き換わる） */
  name: string;
  /** 本文のバイト数（UTF-8） */
  size: number;
  /** チャンクの数 */
  chunkCount: number;
  /** チャンクの埋め込みを作ったモデル */
  embeddingModel: string;
  /** 今の埋め込みのモデルと違うモデルで作ったなら true（検索に使わない。作り直すと使える） */
  needsRebuild: boolean;
  /** 最初に取り込んだ日時（ISO 文字列） */
  createdAt: string;
  /** 最後に取り込み・作り直しをした日時（ISO 文字列） */
  updatedAt: string;
};
