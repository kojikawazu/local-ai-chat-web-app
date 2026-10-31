import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import type { Prisma } from '@/generated/prisma/client';
import { remapScreenshotIds, toForkTitle } from '@/lib/conversation/fork';
import {
  CONVERSATION_SELECT,
  toConversationResponse,
} from '@/lib/server/conversation';
import { isForeignKeyConstraintError } from '@/lib/server/prisma-error';
import { prisma } from '@/lib/server/prisma';
import {
  parseForkConversationBody,
  readJsonBody,
} from '@/lib/server/request-body';
import { isValidUUID } from '@/lib/shared/validation';

/**
 * 会話の途中の応答から分岐する（#29。`docs/22-conversation-fork.md`）。
 *
 * その応答までのメッセージ（表示と同じ `createdAt` の昇順で、その応答を含む）を新しい会話にコピーし、
 * 新しい会話の `forkedFromMessageId` に分岐した応答を入れる。コピーするのは本文・role・`createdAt`（元のまま）・
 * metadata・添付画像（中身ごと新しい ID で）。metadata の中のツールの画面の ID は、コピーした添付画像の ID に書き換える。
 * ブックマークはコピーしない。タイトルは {@link toForkTitle}、会話の役割は元のまま。
 *
 * 会話・メッセージ・添付画像は 1 回の入れ子の作成（1 つのトランザクション）で作り、途中で失敗したら何も残さない。
 * 読んでから作る間に分岐元の応答が消された場合は、外部キーの違反を 404 にする。
 *
 * @param request - `messageId`（分岐する応答の UUID）を含む JSON ボディを持つリクエスト
 * @param context - ルートコンテキスト。`params` は分岐元の会話の UUID（`id`）を解決する Promise
 * @returns 成功時は分岐した会話（一覧の 1 件と同じ形。`forkedFrom` 付き）の JSON（ステータス 201）。ID の形・ボディの不正・user のメッセージは 400、
 *   会話が無い・メッセージがその会話に無い・コピーの途中で応答が消えた場合は 404、保存の失敗は 500 の JSON エラーレスポンス
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
  const parsed = raw.ok ? parseForkConversationBody(raw.value) : raw;
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { messageId } = parsed.value;

  try {
    const source = await prisma.conversation.findUnique({
      where: { id },
      select: { title: true, systemPrompt: true },
    });
    if (!source) {
      return NextResponse.json(
        { error: '会話が見つかりません' },
        { status: 404 }
      );
    }

    // 位置を決めるための並びは中身なしで読む（分岐点より後の添付画像の中身まで読まないため）
    const order = await prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true },
    });
    const forkIndex = order.findIndex((message) => message.id === messageId);
    if (forkIndex === -1) {
      return NextResponse.json(
        { error: 'メッセージが見つかりません' },
        { status: 404 }
      );
    }
    if (order[forkIndex].role !== 'assistant') {
      return NextResponse.json(
        { error: '分岐できるのは応答だけです' },
        { status: 400 }
      );
    }

    const copyIds = order.slice(0, forkIndex + 1).map((message) => message.id);
    const rows = await prisma.message.findMany({
      where: { id: { in: copyIds } },
      include: { attachments: { orderBy: { position: 'asc' } } },
    });
    // IN で読むと並びが保証されないため、表示と同じ順に並べ直す
    const position = new Map(copyIds.map((copyId, index) => [copyId, index]));
    rows.sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));

    // 添付画像は新しい ID でコピーする。metadata の中のツールの画面の参照もこの対応で書き換える
    const attachmentIds = new Map<string, string>();
    for (const row of rows) {
      for (const attachment of row.attachments) {
        attachmentIds.set(attachment.id, crypto.randomUUID());
      }
    }

    const created = await prisma.conversation.create({
      data: {
        title: toForkTitle(source.title),
        systemPrompt: source.systemPrompt,
        forkedFromMessageId: messageId,
        messages: {
          create: rows.map((row) => {
            const metadata = remapScreenshotIds(row.metadata, attachmentIds);
            return {
              role: row.role,
              content: row.content,
              // 元の時刻のまま並べる（この後に送るメッセージは今の時刻になり、必ず後ろに並ぶ）
              createdAt: row.createdAt,
              // DB から読んだ JSON の ID だけを書き換えたもので、形は元と同じ JSON のため入力の型として渡せる
              ...(metadata !== null && {
                metadata: metadata as Prisma.InputJsonValue,
              }),
              ...(row.attachments.length > 0 && {
                attachments: {
                  create: row.attachments.map((attachment) => ({
                    // 対応表は直前にすべての添付画像から作ったため、必ずある
                    id: attachmentIds.get(attachment.id) ?? crypto.randomUUID(),
                    position: attachment.position,
                    mimeType: attachment.mimeType,
                    width: attachment.width,
                    height: attachment.height,
                    size: attachment.size,
                    data: attachment.data,
                  })),
                },
              }),
            };
          }),
        },
      },
      select: CONVERSATION_SELECT,
    });

    return NextResponse.json(toConversationResponse(created), { status: 201 });
  } catch (error) {
    // 読んでから作る間に分岐元の応答（会話ごと）が消された
    if (isForeignKeyConstraintError(error)) {
      return NextResponse.json(
        { error: 'メッセージが見つかりません' },
        { status: 404 }
      );
    }
    console.error('Failed to fork conversation:', error);
    return NextResponse.json(
      { error: '会話の分岐に失敗しました' },
      { status: 500 }
    );
  }
}
