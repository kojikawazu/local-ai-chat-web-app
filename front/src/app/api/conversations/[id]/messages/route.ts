import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { isValidUUID, MAX_MESSAGE_LENGTH } from '@/lib/validation';

/**
 * 値が JSON オブジェクトかを判定し、Prisma の JSON 入力型へ絞り込む。
 *
 * `request.json()` の戻り値は定義上 JSON 値のみで構成される（`undefined` や関数、
 * 循環参照は現れない）。したがってオブジェクトであることを確認できれば
 * `Prisma.InputJsonObject` として扱って安全であり、キャストが不要になる。
 * 配列・プリミティブ・`null` は false（metadata はオブジェクト形状で保存する契約）。
 *
 * @param value - 検証対象の値（`request.json()` 由来を想定）
 * @returns JSON オブジェクトなら true
 */
function isJsonObject(value: unknown): value is Prisma.InputJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
 * 指定した会話に新規メッセージを保存し、会話の更新日時を現在時刻に更新する。
 *
 * `role` は `'user'` / `'assistant'` のみ許可。`metadata`（ツール呼び出し情報・
 * 思考過程等）は任意で、JSON オブジェクトの場合のみ保存する（配列・プリミティブを
 * 指定した場合は黙って捨てずに 400 を返す）。
 *
 * @param request - `role`（必須・user|assistant）・`content`（必須・最大 {@link MAX_MESSAGE_LENGTH} 文字）・任意の `metadata` を含む JSON ボディを持つリクエスト
 * @param context - ルートコンテキスト。`params` は対象会話の UUID（`id`）を解決する Promise
 * @returns 成功時は作成されたメッセージの JSON（ステータス 201）。ID が UUID 形式でない・role/content 欠落・role 不正・metadata 非オブジェクト・content 長さ超過は 400、会話が存在しなければ 404、保存失敗は 500 の JSON エラーレスポンス
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidUUID(id)) {
    return NextResponse.json({ error: '無効な会話IDです' }, { status: 400 });
  }

  // metadata は外部入力なので `unknown` で受け、isJsonObject で絞り込んでから使う
  // （typescript.md「外部入力は unknown で受けてナローイングする」）。
  let body: { role?: string; content?: string; metadata?: unknown };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'リクエストボディのJSON形式が不正です' },
      { status: 400 }
    );
  }

  const { role, content, metadata } = body;

  if (!role || !content) {
    return NextResponse.json(
      { error: 'roleとcontentは必須です' },
      { status: 400 }
    );
  }

  if (!['user', 'assistant'].includes(role)) {
    return NextResponse.json(
      { error: 'roleは "user" または "assistant" のみ有効です' },
      { status: 400 }
    );
  }

  // 指定されたのにオブジェクトでない場合は黙って捨てず 400 で明示的に弾く
  if (metadata != null && !isJsonObject(metadata)) {
    return NextResponse.json(
      { error: 'metadataはオブジェクト形式で指定してください' },
      { status: 400 }
    );
  }

  if (content.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      {
        // ロケール既定に依存すると桁区切りが環境で変わるため 'ja-JP' を明示する
        error: `メッセージは${MAX_MESSAGE_LENGTH.toLocaleString('ja-JP')}文字以内で入力してください`,
      },
      { status: 400 }
    );
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

    const message = await prisma.message.create({
      data: {
        conversationId: id,
        role,
        content,
        ...(isJsonObject(metadata) && { metadata }),
      },
    });

    await prisma.conversation.update({
      where: { id },
      data: { updatedAt: new Date() },
    });

    return NextResponse.json(message, { status: 201 });
  } catch (error) {
    console.error('Failed to save message:', error);
    return NextResponse.json(
      { error: 'メッセージの保存に失敗しました' },
      { status: 500 }
    );
  }
}
