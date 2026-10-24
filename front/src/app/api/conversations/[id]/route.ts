import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import {
  parseUpdateConversationBody,
  readJsonBody,
} from '@/lib/server/request-body';
import { isValidUUID } from '@/lib/shared/validation';

/**
 * 会話の役割（システムプロンプト）を変更する（#10）。変更は以降の送信から効く。
 *
 * 変更できるのは `systemPrompt` だけ。`null`・空白のみなら役割を外す。存在しない会話は 404 を返す。
 * 判定は UPDATE 1 文の更新件数で行い（{@link DELETE} と同じ）、存在確認と更新の間に消されても食い違わない。
 * `updatedAt` は `@updatedAt` で更新され、会話一覧の先頭に来る（タイトルの自動生成と同じ扱い）。
 *
 * @param request - `systemPrompt`（文字列か `null`。最大 `MAX_CONVERSATION_SYSTEM_PROMPT_LENGTH` 文字）を含む JSON ボディを持つリクエスト
 * @param context - ルートコンテキスト。`params` は対象会話の UUID（`id`）を解決する Promise
 * @returns 成功時は変更後の会話（`id` / `title` / `systemPrompt` / `createdAt` / `updatedAt`）の JSON。ID フォーマット・ボディの不正は 400、会話が存在しなければ 404、更新失敗は 500 の JSON エラーレスポンス
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidUUID(id)) {
    return NextResponse.json({ error: '無効な会話IDです' }, { status: 400 });
  }

  const raw = await readJsonBody(request);
  const parsed = raw.ok ? parseUpdateConversationBody(raw.value) : raw;
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const { count } = await prisma.conversation.updateMany({
      where: { id },
      data: { systemPrompt: parsed.value.systemPrompt },
    });

    if (count === 0) {
      return NextResponse.json(
        { error: '会話が見つかりません' },
        { status: 404 }
      );
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        systemPrompt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    // 更新の直後に別のリクエストが削除した場合だけ null になる
    if (!conversation) {
      return NextResponse.json(
        { error: '会話が見つかりません' },
        { status: 404 }
      );
    }
    return NextResponse.json(conversation);
  } catch (error) {
    console.error('Failed to update conversation:', error);
    return NextResponse.json(
      { error: '会話の更新に失敗しました' },
      { status: 500 }
    );
  }
}

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
