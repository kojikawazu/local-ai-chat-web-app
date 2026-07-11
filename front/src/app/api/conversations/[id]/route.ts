import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isValidUUID } from '@/lib/validation';

/**
 * 指定した会話を削除する。紐づくメッセージは `onDelete: Cascade` で連鎖削除される。
 *
 * @param _request - リクエスト（本エンドポイントでは本文を参照しないため未使用）
 * @param context - ルートコンテキスト。`params` は削除対象会話の UUID（`id`）を解決する Promise
 * @returns 成功時は `{ success: true }` の JSON。ID フォーマット不正は 400、削除失敗は 500 の JSON エラーレスポンス
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidUUID(id)) {
    return NextResponse.json(
      { error: '無効な会話IDです' },
      { status: 400 }
    );
  }

  try {
    await prisma.conversation.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete conversation:', error);
    return NextResponse.json(
      { error: '会話の削除に失敗しました' },
      { status: 500 }
    );
  }
}
