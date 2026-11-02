import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { deleteKnowledgeDocument } from '@/lib/server/knowledge';
import { isValidUUID } from '@/lib/shared/validation';

/**
 * ドキュメントを削除する（#17）。チャンクもカスケードで消える。
 *
 * 存在しないドキュメントは 404。`deleteMany` の削除件数で判定する（プロンプトテンプレートの削除と同じ）。
 *
 * @param _request - リクエスト（本文を参照しないため未使用）
 * @param context - ルートコンテキスト。`params` は削除するドキュメントの UUID（`id`）を解決する Promise
 * @returns 成功時は `{ success: true }` の JSON。ID の形の不正は 400、見つからなければ 404、削除失敗は 500 の JSON エラーレスポンス
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isValidUUID(id)) {
    return NextResponse.json(
      { error: '無効なドキュメントIDです' },
      { status: 400 }
    );
  }

  try {
    if (!(await deleteKnowledgeDocument(id))) {
      return NextResponse.json(
        { error: 'ドキュメントが見つかりません' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete knowledge document:', error);
    return NextResponse.json(
      { error: 'ドキュメントの削除に失敗しました' },
      { status: 500 }
    );
  }
}
