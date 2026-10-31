import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { DUPLICATE_SHORTCUT_ERROR } from '@/constants/prompt-template/errors';
import { isUniqueConstraintError } from '@/lib/server/prisma-error';
import {
  parsePromptTemplateBody,
  readJsonBody,
} from '@/lib/server/request-body';
import { MAX_PROMPT_TEMPLATES } from '@/lib/shared/validation';

/**
 * プロンプトテンプレートの一覧をショートカットの昇順で取得する（#28）。
 *
 * 入力欄の候補はこの順で並ぶ。件数は {@link MAX_PROMPT_TEMPLATES} 件までのため、ページに分けない。
 *
 * @returns 成功時はテンプレートの配列を含む JSON（`{ templates }`）。取得失敗は 500 の JSON エラーレスポンス
 */
export async function GET() {
  try {
    const templates = await prisma.promptTemplate.findMany({
      orderBy: { shortcut: 'asc' },
    });
    return NextResponse.json({ templates });
  } catch (error) {
    console.error('Failed to fetch prompt templates:', error);
    return NextResponse.json(
      { error: 'テンプレートの一覧の取得に失敗しました' },
      { status: 500 }
    );
  }
}

/**
 * プロンプトテンプレートを作成する（#28）。
 *
 * 件数の上限は作成の前に数える（同時に作られて上限を 1 件超えることは、個人の利用では起きないので許す）。
 * ショートカットの重複は一意制約の違反で判定して 409 を返す。
 *
 * @param request - `name`・`shortcut`・`content` を含む JSON ボディを持つリクエスト（{@link parsePromptTemplateBody}）
 * @returns 成功時は作成したテンプレートの JSON（ステータス 201）。ボディの不正・件数の上限は 400、ショートカットの重複は 409、作成失敗は 500 の JSON エラーレスポンス
 */
export async function POST(request: NextRequest) {
  const raw = await readJsonBody(request);
  const parsed = raw.ok ? parsePromptTemplateBody(raw.value) : raw;
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const count = await prisma.promptTemplate.count();
    if (count >= MAX_PROMPT_TEMPLATES) {
      return NextResponse.json(
        {
          error: `テンプレートは${MAX_PROMPT_TEMPLATES}件まで保存できます`,
        },
        { status: 400 }
      );
    }

    const template = await prisma.promptTemplate.create({
      data: parsed.value,
    });
    return NextResponse.json(template, { status: 201 });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return NextResponse.json(
        { error: DUPLICATE_SHORTCUT_ERROR },
        { status: 409 }
      );
    }
    console.error('Failed to create prompt template:', error);
    return NextResponse.json(
      { error: 'テンプレートの作成に失敗しました' },
      { status: 500 }
    );
  }
}
