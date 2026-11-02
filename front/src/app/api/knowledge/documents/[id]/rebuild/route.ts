import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { rebuildKnowledgeDocument } from '@/lib/server/knowledge';
import {
  knowledgeErrorResponse,
  knowledgeLimitResponse,
} from '@/lib/server/knowledge-response';
import { isValidUUID } from '@/lib/shared/validation';

/**
 * 保存した本文から、今の埋め込みのモデルでドキュメントのチャンクを作り直す（#17）。
 *
 * 埋め込みのモデル（`OLLAMA_EMBED_MODEL`）を替えた後、古いモデルで作ったドキュメントを検索に使えるようにする。
 *
 * @param _request - リクエスト（本文を参照しないため未使用）
 * @param context - ルートコンテキスト。`params` は作り直すドキュメントの UUID（`id`）を解決する Promise
 * @returns 成功時は `{ document }` の JSON。ID の形の不正・チャンクの数の上限は 400、見つからなければ 404、
 *   埋め込みを作れなければ 502、保存の失敗は 500 の JSON エラーレスポンス
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isValidUUID(id)) {
    return NextResponse.json(
      { error: '無効なドキュメントIDです' },
      { status: 400 }
    );
  }

  try {
    const result = await rebuildKnowledgeDocument(id);
    if (!result) {
      return NextResponse.json(
        { error: 'ドキュメントが見つかりません' },
        { status: 404 }
      );
    }
    if (!result.ok) return knowledgeLimitResponse(result.reason);
    return NextResponse.json({ document: result.document });
  } catch (error) {
    return knowledgeErrorResponse(error, 'rebuild knowledge document');
  }
}
