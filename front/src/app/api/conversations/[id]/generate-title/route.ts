import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isValidUUID } from '@/lib/validation';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3-coder:latest';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidUUID(id)) {
    return NextResponse.json(
      { error: '無効な会話IDです' },
      { status: 400 }
    );
  }

  let body: { message?: string; model?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'リクエストボディのJSON形式が不正です' },
      { status: 400 }
    );
  }

  const { message, model } = body;
  if (!message || typeof message !== 'string' || !message.trim()) {
    return NextResponse.json(
      { error: 'メッセージが空です' },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || OLLAMA_MODEL,
        messages: [
          {
            role: 'user',
            content: `以下のメッセージに対して、会話のタイトルを日本語で簡潔に生成してください。タイトルのみを出力し、それ以外は何も出力しないでください。20文字以内でお願いします。\n\nメッセージ: ${message.slice(0, 500)}`,
          },
        ],
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error (${response.status})`);
    }

    const data = await response.json();
    const generatedTitle = data.message?.content?.trim().slice(0, 100);

    if (!generatedTitle) {
      return NextResponse.json(
        { error: 'タイトルの生成に失敗しました' },
        { status: 500 }
      );
    }

    const conversation = await prisma.conversation.update({
      where: { id },
      data: { title: generatedTitle },
    });

    return NextResponse.json({ title: conversation.title });
  } catch (error) {
    console.error('Failed to generate title:', error);
    return NextResponse.json(
      { error: 'タイトルの自動生成に失敗しました' },
      { status: 500 }
    );
  }
}
