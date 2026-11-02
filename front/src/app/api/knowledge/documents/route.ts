import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { parseKnowledgeFile, tooLargeError } from '@/lib/knowledge/file';
import { getEmbeddingModel } from '@/lib/llm/ollama';
import {
  importKnowledgeDocument,
  listKnowledgeDocuments,
} from '@/lib/server/knowledge';
import {
  knowledgeErrorResponse,
  knowledgeLimitResponse,
} from '@/lib/server/knowledge-response';
import { MAX_KNOWLEDGE_FILE_BYTES } from '@/lib/shared/validation';

/**
 * multipart のボディのうち、ファイルの中身以外（境界・ヘッダー・ファイル名）に許す大きさ（バイト）。
 * `Content-Length` がファイルの上限とこれの和を超えたら、ボディを読まずに 413 を返す
 */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/**
 * 取り込んだドキュメントの一覧を名前の昇順で取得する（#17）。本文・埋め込みは含めない。
 *
 * 今の埋め込みのモデル（`embeddingModel`）も返す。違うモデルで作ったドキュメントは `needsRebuild` が true になる。
 *
 * @returns 成功時は `{ documents, embeddingModel }` の JSON。取得失敗は 500 の JSON エラーレスポンス
 */
export async function GET() {
  try {
    return NextResponse.json({
      documents: await listKnowledgeDocuments(),
      embeddingModel: getEmbeddingModel(),
    });
  } catch (error) {
    console.error('Failed to fetch knowledge documents:', error);
    return NextResponse.json(
      { error: 'ドキュメントの一覧の取得に失敗しました' },
      { status: 500 }
    );
  }
}

/**
 * ドキュメントを取り込む（#17。`docs/28-rag.md`「取り込み」）。同じ名前のドキュメントがあれば置き換える。
 *
 * `multipart/form-data` の `file` 1 つを受け取り、中身を検証してチャンクに分け、Ollama で埋め込みを作って保存する
 * （応答はそこまで終えてから返す）。`Content-Length` が大きすぎればボディを読まずに 413 を返す。
 *
 * @param request - `file`（`.md`・`.markdown`・`.txt`。{@link MAX_KNOWLEDGE_FILE_BYTES} バイトまで）を含む multipart のリクエスト
 * @returns 新しく作れば 201、置き換えれば 200 の `{ document }` の JSON。ファイルの不正・上限は 400、大きすぎれば 413、
 *   同じ名前を同時に取り込めば 409、埋め込みを作れなければ 502、保存の失敗は 500 の JSON エラーレスポンス
 */
export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get('content-length'));
  if (contentLength > MAX_KNOWLEDGE_FILE_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return NextResponse.json({ error: tooLargeError() }, { status: 413 });
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get('file');
  } catch {
    return NextResponse.json(
      { error: 'multipart/form-data でファイルを送ってください' },
      { status: 400 }
    );
  }
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: 'ファイル（file）がありません' },
      { status: 400 }
    );
  }
  // Content-Length を付けない送り方（chunked）でも、読んだ後の大きさで止める
  if (file.size > MAX_KNOWLEDGE_FILE_BYTES) {
    return NextResponse.json({ error: tooLargeError() }, { status: 413 });
  }

  const parsed = parseKnowledgeFile(
    file.name,
    new Uint8Array(await file.arrayBuffer())
  );
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const result = await importKnowledgeDocument(parsed);
    if (!result.ok) return knowledgeLimitResponse(result.reason);
    return NextResponse.json(
      { document: result.document },
      { status: result.created ? 201 : 200 }
    );
  } catch (error) {
    return knowledgeErrorResponse(error, 'import knowledge document');
  }
}
