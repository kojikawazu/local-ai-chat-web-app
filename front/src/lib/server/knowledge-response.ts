import { NextResponse } from 'next/server';
import { EmbeddingModelNotFoundError } from '@/lib/llm/ollama';
import { EmbeddingUnavailableError } from '@/lib/server/knowledge';
import type { KnowledgeWriteResult } from '@/lib/server/knowledge';
import { isUniqueConstraintError } from '@/lib/server/prisma-error';
import { MAX_KNOWLEDGE_DOCUMENTS } from '@/lib/shared/validation';

/**
 * ドキュメントの取り込み・作り直しが上限に当たったときの応答（#17）。
 *
 * @param reason - 当たった上限
 * @returns 400 の JSON エラーレスポンス（件数の上限はプロンプトテンプレートと同じく 400）
 */
export function knowledgeLimitResponse(
  reason: Extract<KnowledgeWriteResult, { ok: false }>['reason']
): NextResponse {
  const error =
    reason === 'document_limit'
      ? `ドキュメントは${MAX_KNOWLEDGE_DOCUMENTS}件まで取り込めます`
      : 'ドキュメントが細かく分かれすぎるため取り込めません（見出し・段落を減らすか、ファイルを分けてください）';
  return NextResponse.json({ error }, { status: 400 });
}

/**
 * ドキュメントの取り込み・作り直しで投げられた例外を応答にする（#17）。
 *
 * - 埋め込みのモデルが無い → 502（`ollama pull` を案内する）
 * - 埋め込みを作れない（Ollama に繋がらない等）→ 502
 * - 同じ名前を同時に取り込んだ（一意制約の違反）→ 409
 * - そのほか（DB の失敗）→ 500
 *
 * @param error - 取り込み・作り直しが投げた例外
 * @param action - ログに出す処理の名前
 * @returns JSON エラーレスポンス
 */
export function knowledgeErrorResponse(
  error: unknown,
  action: string
): NextResponse {
  if (error instanceof EmbeddingModelNotFoundError) {
    return NextResponse.json(
      {
        error: `埋め込みのモデル（${error.model}）がありません。ollama pull ${error.model} を実行してください`,
      },
      { status: 502 }
    );
  }
  if (error instanceof EmbeddingUnavailableError) {
    console.error(`Failed to ${action} (embedding):`, error.cause);
    return NextResponse.json(
      {
        error:
          '埋め込みを作れませんでした。Ollama が起動しているか、OLLAMA_EMBED_MODEL が埋め込みのモデルかを確かめてください',
      },
      { status: 502 }
    );
  }
  if (isUniqueConstraintError(error)) {
    return NextResponse.json(
      { error: '同じ名前のドキュメントを取り込み中です' },
      { status: 409 }
    );
  }
  console.error(`Failed to ${action}:`, error);
  return NextResponse.json(
    { error: 'ドキュメントの保存に失敗しました' },
    { status: 500 }
  );
}
