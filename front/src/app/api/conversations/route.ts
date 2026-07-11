import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * 会話一覧を更新日時の降順（最新順）で取得する。
 *
 * 一覧表示に必要な `id` / `title` / `createdAt` / `updatedAt` のみを選択して返す。
 *
 * @returns 成功時は会話配列を含む JSON（`{ conversations }`）。取得失敗は 500 の JSON エラーレスポンス
 */
export async function GET() {
  try {
    const conversations = await prisma.conversation.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ conversations });
  } catch (error) {
    console.error('Failed to fetch conversations:', error);
    return NextResponse.json(
      { error: '会話一覧の取得に失敗しました' },
      { status: 500 }
    );
  }
}

/**
 * 新規会話を作成する。
 *
 * `title` は任意で、未指定・空文字・ボディ不正の場合は既定値「新しい会話」を用いる。
 *
 * @param request - 任意の `title` を含む JSON ボディを持つリクエスト（本文が不正でも既定タイトルで作成する）
 * @returns 成功時は作成された会話の JSON（ステータス 201）。作成失敗は 500 の JSON エラーレスポンス
 */
export async function POST(request: NextRequest) {
  let body: { title?: string };

  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const title = body.title?.trim() || '新しい会話';

  try {
    const conversation = await prisma.conversation.create({
      data: { title },
    });

    return NextResponse.json(conversation, { status: 201 });
  } catch (error) {
    console.error('Failed to create conversation:', error);
    return NextResponse.json(
      { error: '会話の作成に失敗しました' },
      { status: 500 }
    );
  }
}
