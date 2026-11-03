import { NextResponse } from 'next/server';
import { EmbeddingModelNotFoundError } from '@/lib/llm/ollama';
import { EmbeddingUnavailableError } from '@/lib/server/knowledge';
import { VaultUnavailableError } from '@/lib/server/knowledge-vault';
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
 * ドキュメントの取り込み・作り直し・会話での検索（#17 Phase B）で投げられた例外を応答にする（#17）。
 *
 * - 埋め込みのモデルが無い → 502（`ollama pull` を案内する）
 * - 埋め込みを作れない（Ollama に繋がらない等）→ 502
 * - 同じ名前を同時に取り込んだ（一意制約の違反）→ 409
 * - 保管庫を読めない（フォルダが無い・既定のブランチが無い・git を実行できない。#235）→ 500（理由をそのまま返す）
 * - そのほか（DB の失敗）→ 500
 *
 * @param error - 取り込み・作り直し・検索が投げた例外
 * @param action - ログに出す処理の名前
 * @param dbErrorMessage - DB の失敗（500）のときに返すメッセージ。省略すると保存の失敗の文言
 * @returns JSON エラーレスポンス
 */
export function knowledgeErrorResponse(
  error: unknown,
  action: string,
  dbErrorMessage = 'ドキュメントの保存に失敗しました'
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
  if (error instanceof VaultUnavailableError) {
    console.error(`Failed to ${action} (vault):`, error.cause ?? error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (isUniqueConstraintError(error)) {
    return NextResponse.json(
      { error: '同じ名前のドキュメントを取り込み中です' },
      { status: 409 }
    );
  }
  console.error(`Failed to ${action}:`, error);
  return NextResponse.json({ error: dbErrorMessage }, { status: 500 });
}
