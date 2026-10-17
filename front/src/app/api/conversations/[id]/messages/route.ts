import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseSaveMessageBody, readJsonBody } from '@/lib/request-body';
import { isValidUUID } from '@/lib/validation';

/**
 * 指定した会話に紐づくメッセージ一覧を作成日時の昇順で取得する。
 *
 * @param _request - リクエスト（本エンドポイントでは本文を参照しないため未使用）
 * @param context - ルートコンテキスト。`params` は対象会話の UUID（`id`）を解決する Promise
 * @returns 成功時はメッセージ配列を含む JSON（`{ messages }`）。ID が UUID 形式でなければ 400、会話が存在しなければ 404、取得失敗は 500 の JSON エラーレスポンス
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidUUID(id)) {
    return NextResponse.json({ error: '無効な会話IDです' }, { status: 400 });
  }

  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: '会話が見つかりません' },
        { status: 404 }
      );
    }

    const messages = await prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json({ messages });
  } catch (error) {
    console.error('Failed to fetch messages:', error);
    return NextResponse.json(
      { error: 'メッセージの取得に失敗しました' },
      { status: 500 }
    );
  }
}

/**
 * 指定した会話に新規メッセージを保存し、会話の更新日時を現在時刻に更新する（両者は同一トランザクション）。
 *
 * `role` は `'user'` / `'assistant'` のみ許可。`metadata`（ツール呼び出し情報・
 * 思考過程等）は任意で、JSON オブジェクトの場合のみ保存する（配列・プリミティブを
 * 指定した場合は黙って捨てずに 400 を返す）。
 *
 * @param request - `role`（必須・user|assistant）・`content`（必須・user は最大 `MAX_MESSAGE_LENGTH` 文字、assistant は最大 `MAX_ASSISTANT_MESSAGE_LENGTH` 文字）・任意の `metadata` を含む JSON ボディを持つリクエスト
 * @param context - ルートコンテキスト。`params` は対象会話の UUID（`id`）を解決する Promise
 * @returns 成功時は作成されたメッセージの JSON（ステータス 201）。ID が UUID 形式でない・JSON 構文不正・ボディが非オブジェクト・role/content 欠落・role 不正・content 非文字列・metadata 非オブジェクト・content 長さ超過は 400、会話が存在しなければ 404、保存失敗は 500 の JSON エラーレスポンス
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidUUID(id)) {
    return NextResponse.json({ error: '無効な会話IDです' }, { status: 400 });
  }

  const raw = await readJsonBody(request);
  const parsed = raw.ok ? parseSaveMessageBody(raw.value) : raw;
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { role, content, metadata } = parsed.value;

  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: '会話が見つかりません' },
        { status: 404 }
      );
    }

    // メッセージ作成と会話の updatedAt 更新を 1 トランザクションにまとめ、
    // 片方だけ成功する部分成功（履歴の並び順と保存内容の食い違い）を防ぐ
    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: {
          conversationId: id,
          role,
          content,
          ...(metadata && { metadata }),
        },
      }),
      prisma.conversation.update({
        where: { id },
        data: { updatedAt: new Date() },
      }),
    ]);

    return NextResponse.json(message, { status: 201 });
  } catch (error) {
    console.error('Failed to save message:', error);
    return NextResponse.json(
      { error: 'メッセージの保存に失敗しました' },
      { status: 500 }
    );
  }
}
