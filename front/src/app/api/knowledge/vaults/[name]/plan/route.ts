import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { isValidVaultName } from '@/lib/knowledge/vault';
import { planKnowledgeVault } from '@/lib/server/knowledge-vault';
import { findKnowledgeVault } from '@/lib/server/knowledge-vault-config';
import { knowledgeErrorResponse } from '@/lib/server/knowledge-response';
import { MAX_KNOWLEDGE_VAULT_FILES } from '@/lib/shared/validation';

/**
 * 保管庫の同期の差分を求める（#235。`docs/28-rag.md`「保管庫の同期（Phase C）」の「流れ」）。
 *
 * 画面はこの差分を受けて、足す・変わった・作り直す・消えたパスを 1 つずつ同期の API に渡す。
 * git の保管庫は既定のブランチのコミット済みの中身だけを見る。DB・保管庫は変えない。
 *
 * @param _request - リクエスト（本文を参照しないため未使用）
 * @param context - ルートコンテキスト。`params` は保管庫の名前（`name`）を解決する Promise
 * @returns 成功時は差分（`VaultSyncPlanResponse`）の JSON。名前の形の不正・ファイルの数の上限は 400、
 *   設定に無い保管庫は 404、保管庫を読めない・DB の失敗は 500 の JSON エラーレスポンス
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  if (!isValidVaultName(name)) {
    return NextResponse.json(
      { error: '無効な保管庫の名前です' },
      { status: 400 }
    );
  }
  const vault = findKnowledgeVault(name);
  if (!vault) {
    return NextResponse.json(
      { error: '保管庫が見つかりません' },
      { status: 404 }
    );
  }

  try {
    const result = await planKnowledgeVault(vault);
    if (!result.ok) {
      return NextResponse.json(
        {
          error: `保管庫のファイルは${MAX_KNOWLEDGE_VAULT_FILES.toLocaleString()}個まで取り込めます（${result.count.toLocaleString()}個あります）`,
        },
        { status: 400 }
      );
    }
    return NextResponse.json(result.plan);
  } catch (error) {
    return knowledgeErrorResponse(
      error,
      'plan knowledge vault',
      '保管庫の差分を求められませんでした'
    );
  }
}
