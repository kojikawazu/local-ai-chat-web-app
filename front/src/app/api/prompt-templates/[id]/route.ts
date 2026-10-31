import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { DUPLICATE_SHORTCUT_ERROR } from '@/constants/prompt-template/errors';
import { isUniqueConstraintError } from '@/lib/server/prisma-error';
import {
  parsePromptTemplateBody,
  readJsonBody,
} from '@/lib/server/request-body';
import { isValidUUID } from '@/lib/shared/validation';

const INVALID_ID_ERROR = '無効なテンプレートIDです';
const NOT_FOUND_ERROR = 'テンプレートが見つかりません';

/**
 * プロンプトテンプレートを置き換える（#28）。名前・ショートカット・本文をすべて送る。
 *
 * 存在しないテンプレートは 404。判定は UPDATE 1 文の更新件数で行う（会話の役割の変更と同じ）。
 * 自分自身と同じショートカットのままの置き換えは重複にならない。
 *
 * @param request - `name`・`shortcut`・`content` を含む JSON ボディを持つリクエスト（{@link parsePromptTemplateBody}）
 * @param context - ルートコンテキスト。`params` は対象のテンプレートの UUID（`id`）を解決する Promise
 * @returns 成功時は置き換えたテンプレートの JSON。ID の形・ボディの不正は 400、見つからなければ 404、ショートカットの重複は 409、更新失敗は 500 の JSON エラーレスポンス
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ error: INVALID_ID_ERROR }, { status: 400 });
  }

  const raw = await readJsonBody(request);
  const parsed = raw.ok ? parsePromptTemplateBody(raw.value) : raw;
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const { count } = await prisma.promptTemplate.updateMany({
      where: { id },
      data: parsed.value,
    });
    if (count === 0) {
      return NextResponse.json({ error: NOT_FOUND_ERROR }, { status: 404 });
    }

    const template = await prisma.promptTemplate.findUnique({ where: { id } });
    // 更新の直後に別のリクエストが削除した場合だけ null になる
    if (!template) {
      return NextResponse.json({ error: NOT_FOUND_ERROR }, { status: 404 });
    }
    return NextResponse.json(template);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return NextResponse.json(
        { error: DUPLICATE_SHORTCUT_ERROR },
        { status: 409 }
      );
    }
    console.error('Failed to update prompt template:', error);
    return NextResponse.json(
      { error: 'テンプレートの更新に失敗しました' },
      { status: 500 }
    );
  }
}

/**
 * プロンプトテンプレートを削除する（#28）。
 *
 * 存在しないテンプレートは 404。`deleteMany` の削除件数で判定する（会話の削除と同じ）。
 *
 * @param _request - リクエスト（本文を参照しないため未使用）
 * @param context - ルートコンテキスト。`params` は削除するテンプレートの UUID（`id`）を解決する Promise
 * @returns 成功時は `{ success: true }` の JSON。ID の形の不正は 400、見つからなければ 404、削除失敗は 500 の JSON エラーレスポンス
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
    const { count } = await prisma.promptTemplate.deleteMany({
      where: { id },
    });
    if (count === 0) {
      return NextResponse.json({ error: NOT_FOUND_ERROR }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete prompt template:', error);
    return NextResponse.json(
      { error: 'テンプレートの削除に失敗しました' },
      { status: 500 }
    );
  }
}
