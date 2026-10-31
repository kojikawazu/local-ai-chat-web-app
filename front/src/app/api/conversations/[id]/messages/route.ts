import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { isUniqueConstraintError } from '@/lib/server/prisma-error';
import { prisma } from '@/lib/server/prisma';
import { parseSaveMessageBody, readJsonBody } from '@/lib/server/request-body';
import { isValidUUID } from '@/lib/shared/validation';

/**
 * 指定した会話に紐づくメッセージ一覧を作成日時の昇順で取得する。
 *
 * 各メッセージには添付画像の情報（ID・形式・寸法。#6）を並び順で付け、付いているブックマークの ID（`bookmark: { id } | null`。#30）を付ける。画像の中身は含めず、
 * `GET /api/attachments/[id]` で取得させる（一覧を画像の中身ごと返すと、1 会話で数十 MB になりうるため）。
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
      include: {
        attachments: {
          select: { id: true, mimeType: true, width: true, height: true },
          orderBy: { position: 'asc' },
        },
        // どの応答に印が付いているかを、会話を開くときの 1 回の取得で分かるようにする（#30）
        bookmark: { select: { id: true } },
      },
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
 * `id` を指定するとその UUID で保存する（クライアントの表示上の ID と DB の ID を揃えるため。#9）。
 * 同じ `id` が既にあれば 409 を返す。クライアントは保存の再試行で 409 を受けたら、前回の保存が
 * 届いていたものとして扱える（UUID v4 の偶然の衝突は無視できるため）。
 *
 * `role` は `'user'` / `'assistant'` のみ許可。`metadata`（ツール呼び出し情報・
 * 思考過程等）は任意で、JSON オブジェクトの場合のみ保存する（配列・プリミティブを
 * 指定した場合は黙って捨てずに 400 を返す）。
 * `attachments` は、user は添付画像（#6）、assistant はブラウザのツールが撮った画面（#200）で、メッセージと同じトランザクションで保存する。
 *
 * @param request - 任意の `id`（UUID）・`role`（必須・user|assistant）・`content`（必須・user は最大 `MAX_MESSAGE_LENGTH` 文字、assistant は最大 `MAX_ASSISTANT_MESSAGE_LENGTH` 文字）・任意の `metadata`・任意の `attachments`（`{ id, data, width, height }` の配列。`data` は PNG / JPEG の Base64）を含む JSON ボディを持つリクエスト
 * @param context - ルートコンテキスト。`params` は対象会話の UUID（`id`）を解決する Promise
 * @returns 成功時は作成されたメッセージの JSON（ステータス 201）。ID が UUID 形式でない・JSON 構文不正・ボディが非オブジェクト・role/content 欠落・role 不正・content 非文字列・metadata 非オブジェクト・content 長さ超過・id が UUID 形式でない・attachments の不正は 400、会話が存在しなければ 404、同じ id のメッセージが既にあれば 409、保存失敗は 500 の JSON エラーレスポンス
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

  const { id: messageId, role, content, metadata, attachments } = parsed.value;

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
          ...(messageId && { id: messageId }),
          conversationId: id,
          role,
          content,
          ...(metadata && { metadata }),
          // 添付も同じトランザクションで作り、メッセージと片方だけ残らないようにする
          ...(attachments.length > 0 && {
            attachments: {
              create: attachments.map((attachment, position) => ({
                id: attachment.id,
                position,
                mimeType: attachment.mimeType,
                width: attachment.width,
                height: attachment.height,
                size: attachment.data.length,
                data: attachment.data,
              })),
            },
          }),
        },
      }),
      prisma.conversation.update({
        where: { id },
        data: { updatedAt: new Date() },
      }),
    ]);

    return NextResponse.json(message, { status: 201 });
  } catch (error) {
    // 主キーの重複は、指定された id のメッセージ（または添付）が既にあることを表す
    if (isUniqueConstraintError(error)) {
      return NextResponse.json(
        { error: '同じIDのメッセージが既に存在します' },
        { status: 409 }
      );
    }
    console.error('Failed to save message:', error);
    return NextResponse.json(
      { error: 'メッセージの保存に失敗しました' },
      { status: 500 }
    );
  }
}
