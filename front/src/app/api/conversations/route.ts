import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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
