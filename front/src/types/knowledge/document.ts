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

/**
 * 応答の出典の 1 件（#17 Phase B）。送ったときに探して見つかった、ドキュメントの一部。
 *
 * `/api/chat` の `knowledge_sources` のイベントで届き、応答のメタデータ（`knowledgeSources`）に写して保存する。
 * ドキュメントを消しても過去の応答の出典が残るよう、ドキュメントへの参照ではなく写しを持つ。
 */
export type KnowledgeSource = {
  /** ドキュメントの名前（ファイル名） */
  documentName: string;
  /** 見出しの経路（「範囲 > 含める」）。見出しの前の部分なら空文字 */
  heading: string;
  /** 抜き出しの先頭（200 文字まで。`lib/knowledge/prompt.ts`）。Markdown として描かず、文字のまま出す */
  excerpt: string;
  /** 質問との類似度（コサイン類似度。-1〜1。大きいほど近い） */
  similarity: number;
};

/**
 * 会話で探して見つかったチャンク（#17 Phase B）。検索（`lib/server/knowledge.ts`）が返し、
 * システムプロンプトと出典（`lib/knowledge/prompt.ts`）に直す。
 */
export type KnowledgeHit = {
  /** ドキュメントの名前 */
  documentName: string;
  /** 見出しの経路。見出しの前なら空文字 */
  heading: string;
  /** チャンクの本文 */
  content: string;
  /** 質問とのコサイン類似度 */
  similarity: number;
};
