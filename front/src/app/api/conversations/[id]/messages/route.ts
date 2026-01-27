import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

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
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: { role?: string; content?: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'リクエストボディのJSON形式が不正です' },
      { status: 400 }
    );
  }

  const { role, content } = body;

  if (!role || !content) {
    return NextResponse.json(
      { error: 'roleとcontentは必須です' },
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
