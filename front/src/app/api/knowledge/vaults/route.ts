import { NextResponse } from 'next/server';
import { getEmbeddingModel } from '@/lib/llm/ollama';
import { listKnowledgeVaults } from '@/lib/server/knowledge-vault';

/**
 * RAG の保管庫の一覧を取得する（#235。`docs/28-rag.md`「保管庫の同期（Phase C）」）。
 *
 * 設定（`KNOWLEDGE_VAULTS`）にある保管庫を設定の順に、その後に索引だけ残っている保管庫を名前の順に返す。
 * 設定にある保管庫は、読む版（git の既定のブランチとコミット）と、読めないときの理由を含む。
 *
 * @returns 成功時は `{ vaults, embeddingModel }` の JSON。取得失敗は 500 の JSON エラーレスポンス
 */
export async function GET() {
  try {
    return NextResponse.json({
      vaults: await listKnowledgeVaults(),
      embeddingModel: getEmbeddingModel(),
    });
  } catch (error) {
    console.error('Failed to fetch knowledge vaults:', error);
    return NextResponse.json(
      { error: '保管庫の一覧の取得に失敗しました' },
      { status: 500 }
    );
  }
}
