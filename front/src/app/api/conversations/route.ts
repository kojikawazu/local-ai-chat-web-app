import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseCreateConversationBody, readJsonBody } from '@/lib/request-body';

/**
 * 会話一覧を更新日時の降順（最新順）で取得する。
 *
 * 一覧表示に必要な `id` / `title` / `systemPrompt`（会話の役割。#10）/ `createdAt` / `updatedAt` のみを選択して返す。
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
        systemPrompt: true,
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
 * `title` は任意で、未指定・空文字・空のボディの場合は既定値「新しい会話」を用いる。
 * `systemPrompt`（会話の役割。#10）も任意で、未指定・空白のみなら役割なし（`null`）で作る。
 * 最初の送信の前に選んだ役割を、会話の作成と同時に保存するために受け付ける。
 * ボディがあるのに JSON として不正・オブジェクトでない・`title` / `systemPrompt` が文字列でない場合は 400 を返す
 * （{@link parseCreateConversationBody}）。
 *
 * @param request - 任意の `title`（最大 `MAX_TITLE_LENGTH` 文字）と `systemPrompt`（最大 `MAX_CONVERSATION_SYSTEM_PROMPT_LENGTH` 文字）を含む JSON ボディを持つリクエスト（ボディ省略可）
 * @returns 成功時は作成された会話の JSON（ステータス 201）。JSON 構文・形・型の不正と長さ超過は 400、作成失敗は 500 の JSON エラーレスポンス
 */
export async function POST(request: NextRequest) {
  const raw = await readJsonBody(request, { allowEmpty: true });
  const parsed = raw.ok ? parseCreateConversationBody(raw.value) : raw;
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { title, systemPrompt } = parsed.value;

  try {
    const conversation = await prisma.conversation.create({
      data: { title, systemPrompt },
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
