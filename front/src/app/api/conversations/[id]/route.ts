import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isValidUUID } from '@/lib/validation';

/**
 * 指定した会話を削除する。紐づくメッセージは `onDelete: Cascade` で連鎖削除される。
 *
 * 存在しない会話は 404 を返す（#97）。`delete` は対象が無いと例外を投げ、DB 障害と区別できないため、
 * `deleteMany` の削除件数で判定する。判定は DELETE 1 文の結果だけで決まるため、存在確認と削除の
 * 間に別のリクエストが消しても食い違わない。
 *
 * @param _request - リクエスト（本エンドポイントでは本文を参照しないため未使用）
 * @param context - ルートコンテキスト。`params` は削除対象会話の UUID（`id`）を解決する Promise
 * @returns 成功時は `{ success: true }` の JSON。ID フォーマット不正は 400、会話が存在しなければ 404、削除失敗は 500 の JSON エラーレスポンス
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidUUID(id)) {
    return NextResponse.json({ error: '無効な会話IDです' }, { status: 400 });
  }

  try {
    const { count } = await prisma.conversation.deleteMany({
      where: { id },
    });

    if (count === 0) {
      return NextResponse.json(
        { error: '会話が見つかりません' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete conversation:', error);
    return NextResponse.json(
      { error: '会話の削除に失敗しました' },
      { status: 500 }
    );
  }
}
