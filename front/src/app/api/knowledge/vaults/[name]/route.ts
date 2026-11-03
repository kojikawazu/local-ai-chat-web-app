import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { isValidVaultName } from '@/lib/knowledge/vault';
import { deleteKnowledgeVaultIndex } from '@/lib/server/knowledge-vault';

/**
 * 設定に無い保管庫の索引（その保管庫から取り込んだドキュメント）を消す（#235 の C7）。
 *
 * 設定（`KNOWLEDGE_VAULTS`）にある保管庫は消さない（次の同期で戻るため。設定から外してから消す）。
 *
 * @param _request - リクエスト（本文を参照しないため未使用）
 * @param context - ルートコンテキスト。`params` は保管庫の名前（`name`）を解決する Promise
 * @returns 成功時は `{ success: true }` の JSON。名前の形の不正は 400、設定にある保管庫は 409、
 *   索引に無ければ 404、削除の失敗は 500 の JSON エラーレスポンス
 */
export async function DELETE(
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

  try {
    const result = await deleteKnowledgeVaultIndex(name);
    if (result === 'configured') {
      return NextResponse.json(
        {
          error:
            '設定（KNOWLEDGE_VAULTS）にある保管庫の索引は消せません。設定から外してから消してください',
        },
        { status: 409 }
      );
    }
    if (result === 'not_found') {
      return NextResponse.json(
        { error: '保管庫が見つかりません' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete knowledge vault index:', error);
    return NextResponse.json(
      { error: '保管庫の索引の削除に失敗しました' },
      { status: 500 }
    );
  }
}
