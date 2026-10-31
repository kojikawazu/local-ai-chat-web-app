import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { parseBookmarkNoteBody, readJsonBody } from '@/lib/server/request-body';
import { isValidUUID } from '@/lib/shared/validation';

const INVALID_ID_ERROR = '無効なブックマークIDです';
const NOT_FOUND_ERROR = 'ブックマークが見つかりません';

/**
 * ブックマークのメモを書き換える（#30）。`null`（または空白だけ）を送るとメモを消す。
 *
 * 存在しないブックマークは 404。判定は UPDATE 1 文の更新件数で行う（会話の役割の変更と同じ）。
 *
 * @param request - `note`（文字列か `null`）を含む JSON ボディを持つリクエスト（{@link parseBookmarkNoteBody}）
 * @param context - ルートコンテキスト。`params` は対象のブックマークの UUID（`id`）を解決する Promise
 * @returns 成功時は書き換えたブックマークの JSON。ID の形・ボディの不正は 400、見つからなければ 404、更新の失敗は 500 の JSON エラーレスポンス
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ error: INVALID_ID_ERROR }, { status: 400 });
  }

  const raw = await readJsonBody(request);
  const parsed = raw.ok ? parseBookmarkNoteBody(raw.value) : raw;
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const { count } = await prisma.bookmark.updateMany({
      where: { id },
      data: { note: parsed.value.note },
    });
    if (count === 0) {
      return NextResponse.json({ error: NOT_FOUND_ERROR }, { status: 404 });
    }

    const bookmark = await prisma.bookmark.findUnique({ where: { id } });
    // 更新の直後に別のリクエストが外した（会話を消した）場合だけ null になる
    if (!bookmark) {
      return NextResponse.json({ error: NOT_FOUND_ERROR }, { status: 404 });
    }
    return NextResponse.json(bookmark);
  } catch (error) {
    console.error('Failed to update bookmark:', error);
    return NextResponse.json(
      { error: 'メモの保存に失敗しました' },
      { status: 500 }
    );
  }
}

/**
 * ブックマークを外す（#30）。
 *
 * 存在しないブックマークは 404。`deleteMany` の削除件数で判定する（会話の削除と同じ）。
 *
 * @param _request - リクエスト（本文を参照しないため未使用）
 * @param context - ルートコンテキスト。`params` は外すブックマークの UUID（`id`）を解決する Promise
 * @returns 成功時は `{ success: true }` の JSON。ID の形の不正は 400、見つからなければ 404、削除の失敗は 500 の JSON エラーレスポンス
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ error: INVALID_ID_ERROR }, { status: 400 });
  }

  try {
    const { count } = await prisma.bookmark.deleteMany({ where: { id } });
    if (count === 0) {
      return NextResponse.json({ error: NOT_FOUND_ERROR }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete bookmark:', error);
    return NextResponse.json(
      { error: 'ブックマークを外せませんでした' },
      { status: 500 }
    );
  }
}
