import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { isUniqueConstraintError } from '@/lib/server/prisma-error';

/**
 * 「例を追加」で作るテンプレート（#28）。既定のテンプレートは持たず、一覧が空のときに押して作る。
 *
 * 本文の末尾の空行は、入れた後にカーソルの次の行から書き始めるため（本文の前後の改行は保存のまま残る）。
 */
const EXAMPLE_TEMPLATES = [
  {
    shortcut: 'translate',
    name: '英語に翻訳',
    content: '以下を自然な英語に翻訳してください。\n\n',
  },
  {
    shortcut: 'review',
    name: 'コードレビュー',
    content:
      '以下のコードをレビューし、不具合・可読性・性能・セキュリティの観点で改善点を重要なものから挙げてください。\n\n',
  },
  {
    shortcut: 'summarize',
    name: '要約',
    content: '以下を 3〜5 行で要約してください。\n\n',
  },
  {
    // 応答の「保存」→ スライド（#36）が `---` で 1 枚ずつ分ける。全体をコードブロックで囲まれると 1 枚のコードになるため止める
    shortcut: 'slides',
    name: 'スライドにまとめる',
    content:
      '以下の内容を発表用のスライドにまとめてください。1 枚目はタイトルのスライドにし、スライドの間は `---` だけの行で区切り、各スライドは `## 見出し` で始めて箇条書きを 3〜5 個にしてください。全体をコードブロックで囲まないでください。\n\n',
  },
] as const;

const NOT_EMPTY_ERROR = 'テンプレートが既にあるため、例は追加できません';

/** 一覧が空でなかったことをトランザクションの外へ伝える例外（ロールバックさせるために投げる） */
class NotEmptyError extends Error {}

/**
 * 例のテンプレート 4 件を作る（#28。一覧が空のときだけ）。
 *
 * 空かの確認と作成を 1 つのトランザクションで行う。二度押しで同時に届いた 2 回目は、確認をすり抜けても
 * ショートカットの一意制約で失敗するため、どちらも 409 にして何も作らない。
 *
 * @returns 成功時は作った 4 件（ショートカットの昇順）を含む JSON（`{ templates }`、ステータス 201）。一覧が空でなければ 409、作成失敗は 500 の JSON エラーレスポンス
 */
export async function POST() {
  try {
    const templates = await prisma.$transaction(async (tx) => {
      if ((await tx.promptTemplate.count()) > 0) throw new NotEmptyError();
      await tx.promptTemplate.createMany({ data: [...EXAMPLE_TEMPLATES] });
      return tx.promptTemplate.findMany({ orderBy: { shortcut: 'asc' } });
    });
    return NextResponse.json({ templates }, { status: 201 });
  } catch (error) {
    if (error instanceof NotEmptyError || isUniqueConstraintError(error)) {
      return NextResponse.json({ error: NOT_EMPTY_ERROR }, { status: 409 });
    }
    console.error('Failed to create example prompt templates:', error);
    return NextResponse.json(
      { error: '例のテンプレートの作成に失敗しました' },
      { status: 500 }
    );
  }
}
