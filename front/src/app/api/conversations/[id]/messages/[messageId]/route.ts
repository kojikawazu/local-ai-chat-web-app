import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/server/prisma';
import {
  parseReplaceMessageBody,
  readJsonBody,
} from '@/lib/server/request-body';
import { isValidUUID } from '@/lib/shared/validation';

/**
 * 指定した assistant の応答を、再生成した応答で置き換える（#9）。
 *
 * 本文・metadata を書き換え、`createdAt` を現在時刻にする（表示する時刻を再生成した時刻にするため。
 * 再生成できるのは最後の応答だけなので、並び順は変わらない）。`metadata` を省略すると旧応答の
 * metadata は消す（思考過程・ツール結果が別の応答のものとして残らないように）。
 * 会話の `updatedAt` の更新と同じトランザクションで行う。旧応答の添付画像（ブラウザのツールが撮った画面。#200）は消し、
 * `attachments` に入れ替える（旧応答の記録から参照されなくなった画像を残さないため）。
 *
 * 対象は「この会話に属する assistant のメッセージ」に限る。条件を `updateMany` の where に含め、
 * 更新件数 0 を 404 とする（存在確認と更新の間に削除されても食い違わない）。
 *
 * @param request - `content`（必須・最大 `MAX_ASSISTANT_MESSAGE_LENGTH` 文字）・任意の `metadata`・任意の `attachments`（`{ id, data, width, height }` の配列。PNG / JPEG の Base64）を含む JSON ボディを持つリクエスト
 * @param context - ルートコンテキスト。`params` は会話の UUID（`id`）と置き換えるメッセージの UUID（`messageId`）を解決する Promise
 * @returns 成功時は置き換え後のメッセージの JSON。ID が UUID 形式でない・ボディが不正なら 400、会話に属する assistant の応答が無ければ 404、更新失敗は 500 の JSON エラーレスポンス
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  const { id, messageId } = await params;

  if (!isValidUUID(id)) {
    return NextResponse.json({ error: '無効な会話IDです' }, { status: 400 });
  }
  if (!isValidUUID(messageId)) {
    return NextResponse.json(
      { error: '無効なメッセージIDです' },
      { status: 400 }
    );
  }

  const raw = await readJsonBody(request);
  const parsed = raw.ok ? parseReplaceMessageBody(raw.value) : raw;
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { content, metadata, attachments } = parsed.value;

  try {
    const message = await prisma.$transaction(async (tx) => {
      const { count } = await tx.message.updateMany({
        where: { id: messageId, conversationId: id, role: 'assistant' },
        data: {
          content,
          // Json? 列を NULL にするには DbNull を渡す（undefined だと旧応答の metadata が残る）
          metadata: metadata ?? Prisma.DbNull,
          createdAt: new Date(),
        },
      });
      if (count === 0) return null;
      await tx.attachment.deleteMany({ where: { messageId } });
      if (attachments.length > 0) {
        await tx.attachment.createMany({
          data: attachments.map((attachment, position) => ({
            id: attachment.id,
            messageId,
            position,
            mimeType: attachment.mimeType,
            width: attachment.width,
            height: attachment.height,
            size: attachment.data.length,
            data: attachment.data,
          })),
        });
      }
      await tx.conversation.update({
        where: { id },
        data: { updatedAt: new Date() },
      });
      return tx.message.findUnique({ where: { id: messageId } });
    });

    if (!message) {
      return NextResponse.json(
        { error: '置き換える応答が見つかりません' },
        { status: 404 }
      );
    }

    return NextResponse.json(message);
  } catch (error) {
    console.error('Failed to replace message:', error);
    return NextResponse.json(
      { error: 'メッセージの保存に失敗しました' },
      { status: 500 }
    );
  }
}
