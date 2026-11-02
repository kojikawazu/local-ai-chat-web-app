import type { KnowledgeChunkDraft } from './chunk';

/**
 * 決まった前置きで精度が上がるモデルか（#17）。
 *
 * `embeddinggemma` は質問と本文に決まった前置きを付ける作りで、docs で比べて MRR が 0.942 → 0.975 に上がった
 * （`docs/28-rag.md`「前提の調査」）。前置きはモデルごとに違うため、ほかのモデルには付けない。
 *
 * @param model - 埋め込みのモデル名
 * @returns `embeddinggemma` の系統なら true
 */
function usesGemmaPrompts(model: string): boolean {
  return model.startsWith('embeddinggemma');
}

/**
 * チャンクの埋め込みを作るときに渡す文を組み立てる（#17）。
 *
 * 見出しの経路を一緒に渡し、本文だけでは分からない文脈（どの節の話か）を埋め込みに含める。
 *
 * @param model - 埋め込みのモデル名
 * @param chunk - チャンク
 * @returns モデルへ渡す文
 */
export function documentEmbeddingText(
  model: string,
  chunk: KnowledgeChunkDraft
): string {
  if (usesGemmaPrompts(model)) {
    return `title: ${chunk.heading || 'none'} | text: ${chunk.content}`;
  }
  return chunk.heading ? `${chunk.heading}\n${chunk.content}` : chunk.content;
}

/**
 * 質問の埋め込みを作るときに渡す文を組み立てる（#17。Phase B の検索で使う）。
 *
 * @param model - 埋め込みのモデル名
 * @param query - 利用者の質問
 * @returns モデルへ渡す文
 */
export function queryEmbeddingText(model: string, query: string): string {
  return usesGemmaPrompts(model)
    ? `task: search result | query: ${query}`
    : query;
}

/**
 * 埋め込みを pgvector の文字の形（`[0.1,0.2,…]`）にする（#17）。
 *
 * SQL へはこの文字列をパラメータで渡し、`::vector` で型を変える（文字列を SQL に連結しない）。
 *
 * @param vector - 埋め込み
 * @returns pgvector が読める文字の形
 */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
