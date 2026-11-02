import { randomUUID } from 'node:crypto';
import { Prisma } from '@/generated/prisma/client';
import { chunkDocument } from '@/lib/knowledge/chunk';
import type { KnowledgeChunkDraft } from '@/lib/knowledge/chunk';
import {
  documentEmbeddingText,
  toVectorLiteral,
} from '@/lib/knowledge/embedding-text';
import { compareKnowledgeNames, knowledgeFileKind } from '@/lib/knowledge/file';
import type { KnowledgeFileKind } from '@/lib/knowledge/file';
import {
  embed,
  EmbeddingModelNotFoundError,
  getEmbeddingModel,
} from '@/lib/llm/ollama';
import { prisma } from '@/lib/server/prisma';
import { MAX_KNOWLEDGE_DOCUMENTS } from '@/lib/shared/validation';
import type { KnowledgeDocumentItem } from '@/types/knowledge/document';

/**
 * 1 つのドキュメントのチャンクの最大数（#17）。
 *
 * 1 MB のファイルでも約 1,700 に収まる。見出しだけが並ぶような極端なファイルで、埋め込みの作成が長引かないための上限。
 */
const MAX_CHUNKS_PER_DOCUMENT = 2_000;

/** 1 回に Ollama へ送る埋め込みの件数（1 回の量を抑える） */
const EMBED_BATCH_SIZE = 32;

/**
 * 1 つの INSERT 文で入れるチャンクの数。1 行に 6 つのパラメータを使い、PostgreSQL のパラメータの上限（65,535）と
 * 1 文の大きさ（768 次元の埋め込みは文字で約 8 KB）を抑える
 */
const INSERT_BATCH_SIZE = 100;

/**
 * 取り込み・作り直しのトランザクションの時間の上限（ミリ秒）。Prisma の既定（5 秒）では、2,000 チャンクの埋め込み
 * （文字で約 16 MB）を入れきれないことがあるため延ばす。埋め込みはトランザクションの前に作り終えている
 */
const TRANSACTION_TIMEOUT_MS = 60_000;

/**
 * 埋め込みを作れなかったときのエラー（Ollama に繋がらない・埋め込みに対応していないモデル・応答の形が違う。#17）。
 *
 * route が DB の失敗（500）と分けて 502 にするため、Ollama の失敗をこの型に包む。モデルが無いときは
 * {@link EmbeddingModelNotFoundError} のまま投げる（`ollama pull` を案内するため）。
 */
export class EmbeddingUnavailableError extends Error {
  /**
   * @param cause - Ollama の呼び出しで起きた例外
   */
  constructor(cause: unknown) {
    super('埋め込みを作れませんでした', { cause });
    this.name = 'EmbeddingUnavailableError';
  }
}

/**
 * 取り込み・作り直しの結果。上限に当たったときは理由を返す（例外にしない）。
 */
export type KnowledgeWriteResult =
  | {
      ok: true;
      /** 取り込んだ・作り直したドキュメント */
      document: KnowledgeDocumentItem;
      /** 新しく作ったなら true（同じ名前を置き換えた・作り直したなら false） */
      created: boolean;
    }
  | {
      ok: false;
      /** 件数の上限・チャンクの数の上限 */
      reason: 'document_limit' | 'too_many_chunks';
    };

/** 一覧の 1 件に要る列（本文・埋め込みは読まない） */
const DOCUMENT_SELECT = {
  id: true,
  name: true,
  size: true,
  embeddingModel: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { chunks: true } },
} satisfies Prisma.KnowledgeDocumentSelect;

/**
 * DB の行を一覧の 1 件の形にする。
 *
 * @param row - {@link DOCUMENT_SELECT} で読んだ行
 * @param model - 今の埋め込みのモデル
 * @returns 一覧の 1 件
 */
function toItem(
  row: Prisma.KnowledgeDocumentGetPayload<{ select: typeof DOCUMENT_SELECT }>,
  model: string
): KnowledgeDocumentItem {
  return {
    id: row.id,
    name: row.name,
    size: row.size,
    chunkCount: row._count.chunks,
    embeddingModel: row.embeddingModel,
    needsRebuild: row.embeddingModel !== model,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * 取り込んだドキュメントの一覧を名前の昇順で返す（#17）。
 *
 * 並びは {@link compareKnowledgeNames}（画面が取り込んだものを足すときと同じ順）。件数は
 * {@link MAX_KNOWLEDGE_DOCUMENTS} 件までなので、全件を読んでから並べる。
 *
 * @returns 一覧
 */
export async function listKnowledgeDocuments(): Promise<
  KnowledgeDocumentItem[]
> {
  const model = getEmbeddingModel();
  const rows = await prisma.knowledgeDocument.findMany({
    select: DOCUMENT_SELECT,
  });
  return rows
    .map((row) => toItem(row, model))
    .sort((a, b) => compareKnowledgeNames(a.name, b.name));
}

/**
 * チャンクの埋め込みを、決まった件数ずつ Ollama で作る。
 *
 * @param chunks - チャンク
 * @param model - 埋め込みのモデル（前置きの選び方に使う）
 * @returns チャンクと同じ順の埋め込み
 * @throws {EmbeddingModelNotFoundError} モデルが Ollama に無い場合
 * @throws {EmbeddingUnavailableError} そのほかの理由で埋め込みを作れない場合
 */
async function embedChunks(
  chunks: KnowledgeChunkDraft[],
  model: string
): Promise<number[][]> {
  const vectors: number[][] = [];
  try {
    for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
      const texts = chunks
        .slice(i, i + EMBED_BATCH_SIZE)
        .map((chunk) => documentEmbeddingText(model, chunk));
      vectors.push(...(await embed(texts)));
    }
  } catch (error) {
    if (error instanceof EmbeddingModelNotFoundError) throw error;
    throw new EmbeddingUnavailableError(error);
  }
  return vectors;
}

/**
 * 本文をチャンクに分け、埋め込みを作る（トランザクションの前に済ませる）。
 *
 * @param content - 本文
 * @param kind - 種類
 * @param model - 埋め込みのモデル
 * @returns チャンクと埋め込み。チャンクが多すぎれば `null`
 */
async function prepareChunks(
  content: string,
  kind: KnowledgeFileKind,
  model: string
): Promise<{ chunks: KnowledgeChunkDraft[]; vectors: number[][] } | null> {
  const chunks = chunkDocument(content, kind);
  if (chunks.length > MAX_CHUNKS_PER_DOCUMENT) return null;
  return { chunks, vectors: await embedChunks(chunks, model) };
}

/**
 * ドキュメントのチャンクを入れ替える（古いチャンクを消して、新しいチャンクを入れる）。
 *
 * `vector` の列は Prisma の `create` で書けないため `$executeRaw` で入れる。値はすべてパラメータで渡し、埋め込みは
 * 文字の形（`[0.1,…]`）を `::vector` にする（SQL に文字列を連結しない）。
 *
 * @param tx - トランザクションのクライアント
 * @param documentId - ドキュメントの ID
 * @param chunks - 新しいチャンク
 * @param vectors - チャンクと同じ順の埋め込み
 */
async function replaceChunks(
  tx: Prisma.TransactionClient,
  documentId: string,
  chunks: KnowledgeChunkDraft[],
  vectors: number[][]
): Promise<void> {
  await tx.knowledgeChunk.deleteMany({ where: { documentId } });
  for (let i = 0; i < chunks.length; i += INSERT_BATCH_SIZE) {
    const rows = chunks
      .slice(i, i + INSERT_BATCH_SIZE)
      .map(
        (chunk, offset) =>
          Prisma.sql`(${randomUUID()}, ${documentId}, ${i + offset}, ${chunk.heading}, ${chunk.content}, ${toVectorLiteral(vectors[i + offset])}::vector)`
      );
    await tx.$executeRaw`INSERT INTO "KnowledgeChunk" ("id", "documentId", "position", "heading", "content", "embedding") VALUES ${Prisma.join(rows)}`;
  }
}

/**
 * ドキュメントを取り込む（#17。`docs/28-rag.md`「取り込み」）。同じ名前のドキュメントがあれば置き換える。
 *
 * 埋め込みを全部作ってから、1 つのトランザクションで保存する（途中で失敗したら何も残さない）。置き換えでは ID と
 * 最初の取り込みの日時を保つ。件数の上限は新しく作るときだけ数える（置き換えは件数を増やさない）。
 * 同じ名前を同時に新しく取り込むと、後のほうが一意制約の違反（`P2002`）で失敗する（route が 409 にする）。
 *
 * @param file - 検証を通ったファイル（名前・種類・本文・バイト数）
 * @param file.name - ドキュメントの名前
 * @param file.kind - 種類
 * @param file.content - 本文
 * @param file.size - 本文のバイト数
 * @returns 取り込んだドキュメントと、新しく作ったか。上限に当たれば理由
 * @throws {EmbeddingModelNotFoundError} 埋め込みのモデルが Ollama に無い場合
 * @throws {EmbeddingUnavailableError} そのほかの理由で埋め込みを作れない場合
 */
export async function importKnowledgeDocument(file: {
  name: string;
  kind: KnowledgeFileKind;
  content: string;
  size: number;
}): Promise<KnowledgeWriteResult> {
  const model = getEmbeddingModel();
  const existing = await prisma.knowledgeDocument.findUnique({
    where: { name: file.name },
    select: { id: true },
  });
  if (
    !existing &&
    (await prisma.knowledgeDocument.count()) >= MAX_KNOWLEDGE_DOCUMENTS
  ) {
    return { ok: false, reason: 'document_limit' };
  }

  const prepared = await prepareChunks(file.content, file.kind, model);
  if (!prepared) return { ok: false, reason: 'too_many_chunks' };

  const data = {
    content: file.content,
    size: file.size,
    embeddingModel: model,
  };
  const id = await prisma.$transaction(
    async (tx) => {
      // 読んだ後に消されていれば作り直す（upsert は名前の一意制約で、同時の新規作成を P2002 にする）
      const document = await tx.knowledgeDocument.upsert({
        where: { name: file.name },
        create: { name: file.name, ...data },
        update: data,
        select: { id: true },
      });
      await replaceChunks(tx, document.id, prepared.chunks, prepared.vectors);
      return document.id;
    },
    { timeout: TRANSACTION_TIMEOUT_MS }
  );

  const row = await prisma.knowledgeDocument.findUniqueOrThrow({
    where: { id },
    select: DOCUMENT_SELECT,
  });
  return { ok: true, document: toItem(row, model), created: !existing };
}

/**
 * 保存した本文から、今の埋め込みのモデルでチャンクを作り直す（#17。モデルを替えた後に使う）。
 *
 * @param id - ドキュメントの ID
 * @returns 作り直したドキュメント。見つからなければ `null`。チャンクが多すぎれば理由
 * @throws {EmbeddingModelNotFoundError} 埋め込みのモデルが Ollama に無い場合
 * @throws {EmbeddingUnavailableError} そのほかの理由で埋め込みを作れない場合
 */
export async function rebuildKnowledgeDocument(
  id: string
): Promise<KnowledgeWriteResult | null> {
  const model = getEmbeddingModel();
  const document = await prisma.knowledgeDocument.findUnique({
    where: { id },
    select: { name: true, content: true },
  });
  if (!document) return null;

  // 取り込めた名前なので種類は必ず決まる。万一決まらなければ見出しで分けない（テキスト）にする
  const kind = knowledgeFileKind(document.name) ?? 'text';
  const prepared = await prepareChunks(document.content, kind, model);
  if (!prepared) return { ok: false, reason: 'too_many_chunks' };

  const updated = await prisma.$transaction(
    async (tx) => {
      // 埋め込みを作る間に消されていたら作り直さない（更新件数 0）
      const { count } = await tx.knowledgeDocument.updateMany({
        where: { id },
        data: { embeddingModel: model },
      });
      if (count === 0) return false;
      await replaceChunks(tx, id, prepared.chunks, prepared.vectors);
      return true;
    },
    { timeout: TRANSACTION_TIMEOUT_MS }
  );
  if (!updated) return null;

  const row = await prisma.knowledgeDocument.findUniqueOrThrow({
    where: { id },
    select: DOCUMENT_SELECT,
  });
  return { ok: true, document: toItem(row, model), created: false };
}

/**
 * ドキュメントを削除する（チャンクはカスケードで消える。#17）。
 *
 * @param id - ドキュメントの ID
 * @returns 削除したなら true。見つからなければ false
 */
export async function deleteKnowledgeDocument(id: string): Promise<boolean> {
  const { count } = await prisma.knowledgeDocument.deleteMany({
    where: { id },
  });
  return count > 0;
}
