import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isValidUUID, MAX_TITLE_LENGTH } from '@/lib/validation';
import { chatOnce } from '@/lib/ollama';
import { parseGenerateTitleBody, readJsonBody } from '@/lib/request-body';

/** タイトル生成時に LLM へ渡すメッセージの最大文字数。全文は不要なため先頭のみ使う。 */
const TITLE_SOURCE_MAX_CHARS = 500;

/**
 * メッセージ内容から LLM で会話タイトルを自動生成し、対象会話に保存する。
 *
 * Ollama に対して「20文字以内の日本語タイトルのみ出力」を指示し、生成結果を
 * {@link MAX_TITLE_LENGTH} 文字に切り詰めて Conversation.title に更新する。
 *
 * モデルの解決（`model` 未指定時のデフォルト）と Ollama への接続は
 * {@link chatOnce} に委譲する。本 route で独自のデフォルト値を持たない。
 *
 * @param request - タイトル生成の元となる `message`（必須）と任意の `model` を含む JSON ボディを持つリクエスト
 * @param context - ルートコンテキスト。`params` は対象会話の UUID（`id`）を解決する Promise
 * @returns 成功時は生成タイトルを含む JSON（`{ title }`）。ID 不正・JSON 構文不正・ボディが非オブジェクト・メッセージ空・model 非文字列は 400、生成失敗・DB 更新失敗は 500 の JSON エラーレスポンス
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
  const parsed = raw.ok ? parseGenerateTitleBody(raw.value) : raw;
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { message, model } = parsed.value;

  try {
    const content = await chatOnce(
      [
        {
          role: 'user',
          content: `以下のメッセージに対して、会話のタイトルを日本語で簡潔に生成してください。タイトルのみを出力し、それ以外は何も出力しないでください。20文字以内でお願いします。\n\nメッセージ: ${message.slice(0, TITLE_SOURCE_MAX_CHARS)}`,
        },
      ],
      model,
      // 短いタイトルに思考は要らず、思考に対応したモデルでは待ち時間が数秒延びるだけのため止める
      { think: false }
    );

    const generatedTitle = content.trim().slice(0, MAX_TITLE_LENGTH);

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
