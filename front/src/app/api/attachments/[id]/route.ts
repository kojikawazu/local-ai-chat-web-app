import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { isValidUUID } from '@/lib/shared/validation';

/**
 * 添付画像の中身を返す（#6）。
 *
 * `Content-Type` は保存時に中身から判定した形式（PNG / JPEG）で、`nosniff` でブラウザに形式を推測させない。
 * 添付は作った後に変わらないため、長くキャッシュさせる。
 *
 * @param _request - リクエスト（本エンドポイントでは本文を参照しないため未使用）
 * @param context - ルートコンテキスト。`params` は添付の UUID（`id`）を解決する Promise
 * @returns 成功時は画像のバイト列。ID が UUID 形式でなければ 400、添付が存在しなければ 404、取得失敗は 500 の JSON エラーレスポンス
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidUUID(id)) {
    return NextResponse.json({ error: '無効な添付IDです' }, { status: 400 });
  }

  try {
    const attachment = await prisma.attachment.findUnique({
      where: { id },
      select: { mimeType: true, data: true },
    });

    if (!attachment) {
      return NextResponse.json(
        { error: '添付が見つかりません' },
        { status: 404 }
      );
    }

    return new Response(attachment.data, {
      headers: {
        'Content-Type': attachment.mimeType,
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('Failed to fetch attachment:', error);
    return NextResponse.json(
      { error: '添付の取得に失敗しました' },
      { status: 500 }
    );
  }
}
