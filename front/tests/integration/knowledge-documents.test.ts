import {
  describe,
  it,
  expect,
  beforeEach,
  afterAll,
  afterEach,
  vi,
} from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/knowledge/documents/route';
import { DELETE } from '@/app/api/knowledge/documents/[id]/route';
import { POST as REBUILD } from '@/app/api/knowledge/documents/[id]/rebuild/route';
import { getEmbeddingModel } from '@/lib/llm/ollama';
import {
  MAX_KNOWLEDGE_DOCUMENTS,
  MAX_KNOWLEDGE_FILE_BYTES,
} from '@/lib/shared/validation';
import { prisma, resetDb, routeContext } from './helpers/db';
import { stubFetch } from './helpers/ollama-stub';

/**
 * `/api/knowledge/documents`（RAG のドキュメントの取り込みと管理。#17 Phase A）の IT。
 *
 * 実 PostgreSQL（pgvector）に、取り込み → 一覧 → 置き換え → 作り直し → 削除を通し、埋め込みが `vector` の列に
 * 入ることを確かめる。Ollama の `/api/embed` だけをスタブにする（真の外部）。
 */
const URL = 'http://localhost/api/knowledge/documents';
const NONEXISTENT = '00000000-0000-0000-0000-000000000000';

/** スタブの埋め込みの次元（実際のモデルより小さくてよい。次元を決めない列なので何次元でも入る） */
const DIMENSION = 4;

/**
 * 文から決まった埋め込みを作る（同じ文なら同じベクトル。中身は検索の精度には使わない）。
 *
 * @param text - 埋め込みを作る文
 * @returns {@link DIMENSION} 次元のベクトル
 */
function fakeVector(text: string): number[] {
  const codes = [...text].map((c) => c.codePointAt(0) ?? 0);
  return Array.from({ length: DIMENSION }, (_, i) =>
    codes.reduce((sum, code, j) => sum + ((code * (i + 1) + j) % 97), 1)
  );
}

/** Ollama の `/api/embed` に送られた入力（呼ばれた順） */
let embedInputs: string[][] = [];

/**
 * Ollama の `/api/embed` を、入力の数だけ埋め込みを返すスタブにする。
 *
 * @param failOnCall - この回目（1 始まり）の呼び出しを失敗させる（省略時は失敗させない）
 * @param failure - 失敗させるときの応答（省略時は Ollama に繋がらない例外）
 */
function stubEmbed(failOnCall?: number, failure?: Response) {
  embedInputs = [];
  stubFetch(async (url, init) => {
    if (!url.endsWith('/api/embed')) throw new Error(`unexpected ${url}`);
    // ボディは embed()（lib/llm/ollama.ts）が JSON.stringify した { model, input } で、形はアプリが決めている
    const { input } = JSON.parse(String(init?.body)) as { input: string[] };
    embedInputs.push(input);
    if (embedInputs.length === failOnCall) {
      if (failure) return failure;
      throw new TypeError('fetch failed');
    }
    return Response.json({ embeddings: input.map(fakeVector) });
  });
}

/**
 * ファイル 1 つを `multipart/form-data` で送る取り込みのリクエストを組み立てる。
 *
 * @param name - ファイル名
 * @param content - 中身（文字列なら UTF-8）
 * @returns 取り込みのリクエスト
 */
function uploadRequest(name: string, content: string | Uint8Array) {
  const form = new FormData();
  const bytes =
    typeof content === 'string' ? new TextEncoder().encode(content) : content;
  // Uint8Array の中身を複製して ArrayBuffer にそろえる（Blob の型は SharedArrayBuffer の Uint8Array を受け付けない）
  form.append('file', new File([bytes.slice()], name));
  return new NextRequest(URL, { method: 'POST', body: form });
}

/**
 * ドキュメントのチャンクを、並び順に DB から読む（埋め込みの次元も）。
 *
 * @param documentId - ドキュメントの ID
 * @returns チャンクの見出し・本文・埋め込みの次元
 */
async function chunksOf(documentId: string) {
  return prisma.$queryRaw<
    { heading: string; content: string; dims: number }[]
  >`SELECT heading, content, vector_dims(embedding) AS dims FROM "KnowledgeChunk" WHERE "documentId" = ${documentId} ORDER BY position`;
}

/** 見出しで 3 つに分かれる Markdown */
const DESIGN_MD =
  '# 設計\n\n概要\n\n## 範囲\n\n含めるもの\n\n## データ\n\n表の説明';

beforeEach(async () => {
  await resetDb();
  stubEmbed();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST・GET /api/knowledge/documents', () => {
  describe('正常系', () => {
    it('取り込んで 201 を返し、チャンクと埋め込みを保存する', async () => {
      const res = await POST(uploadRequest('設計.md', DESIGN_MD));
      expect(res.status).toBe(201);
      const { document } = await res.json();
      expect(document).toMatchObject({
        name: '設計.md',
        size: new TextEncoder().encode(DESIGN_MD).byteLength,
        chunkCount: 3,
        embeddingModel: getEmbeddingModel(),
        needsRebuild: false,
      });

      expect(await chunksOf(document.id)).toEqual([
        { heading: '設計', content: '概要', dims: DIMENSION },
        { heading: '設計 > 範囲', content: '含めるもの', dims: DIMENSION },
        { heading: '設計 > データ', content: '表の説明', dims: DIMENSION },
      ]);
      // 既定のモデル（embeddinggemma）の前置きで、見出しを一緒に渡す
      expect(embedInputs).toEqual([
        [
          'title: 設計 | text: 概要',
          'title: 設計 > 範囲 | text: 含めるもの',
          'title: 設計 > データ | text: 表の説明',
        ],
      ]);
    });

    it('一覧を名前の昇順で返し、本文・埋め込みは含めない', async () => {
      await POST(uploadRequest('b.txt', 'B'));
      await POST(uploadRequest('a.md', 'A'));

      const res = await GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.embeddingModel).toBe(getEmbeddingModel());
      expect(body.documents.map((d: { name: string }) => d.name)).toEqual([
        'a.md',
        'b.txt',
      ]);
      expect(Object.keys(body.documents[0]).sort()).toEqual([
        'chunkCount',
        'createdAt',
        'embeddingModel',
        'id',
        'name',
        'needsRebuild',
        'size',
        'updatedAt',
      ]);
    });

    it('同じ名前で取り込むと 200 で置き換え、ID と最初の日時を保つ', async () => {
      const first = await (
        await POST(uploadRequest('メモ.md', DESIGN_MD))
      ).json();

      const res = await POST(uploadRequest('メモ.md', '新しい本文'));
      expect(res.status).toBe(200);
      const { document } = await res.json();
      expect(document).toMatchObject({
        id: first.document.id,
        createdAt: first.document.createdAt,
        chunkCount: 1,
      });
      expect(await prisma.knowledgeDocument.count()).toBe(1);
      expect(await chunksOf(document.id)).toEqual([
        { heading: '', content: '新しい本文', dims: DIMENSION },
      ]);
    });

    it('多いチャンクは 32 件ずつ埋め込みを作る', async () => {
      const paragraphs = Array.from(
        { length: 40 },
        (_, i) => `## 節${i}\n\n本文${i}`
      );
      const res = await POST(uploadRequest('多い.md', paragraphs.join('\n\n')));
      expect(res.status).toBe(201);
      expect(embedInputs.map((input) => input.length)).toEqual([32, 8]);
      expect((await res.json()).document.chunkCount).toBe(40);
    });
  });

  describe('準正常系', () => {
    it('一覧が空なら空配列', async () => {
      const res = await GET();
      expect((await res.json()).documents).toEqual([]);
    });

    it(`${MAX_KNOWLEDGE_DOCUMENTS} 件あると 400 で作らないが、同じ名前の置き換えはできる`, async () => {
      await prisma.knowledgeDocument.createMany({
        data: Array.from({ length: MAX_KNOWLEDGE_DOCUMENTS }, (_, i) => ({
          name: `d${i}.md`,
          content: 'x',
          size: 1,
          embeddingModel: getEmbeddingModel(),
        })),
      });

      const res = await POST(uploadRequest('new.md', 'x'));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain(
        `${MAX_KNOWLEDGE_DOCUMENTS}件まで`
      );
      expect(embedInputs).toEqual([]);

      const replaced = await POST(uploadRequest('d0.md', '置き換え'));
      expect(replaced.status).toBe(200);
    });

    it('上限を超える大きさは 413 で、埋め込みを作らない', async () => {
      const res = await POST(
        uploadRequest('big.txt', 'a'.repeat(MAX_KNOWLEDGE_FILE_BYTES + 1))
      );
      expect(res.status).toBe(413);
      expect(embedInputs).toEqual([]);
    });

    it('Content-Length が上限を超えていればボディを読まずに 413', async () => {
      const req = new NextRequest(URL, {
        method: 'POST',
        headers: { 'content-length': String(MAX_KNOWLEDGE_FILE_BYTES * 2) },
        body: 'x',
      });
      const res = await POST(req);
      expect(res.status).toBe(413);
    });
  });

  describe('異常系', () => {
    it.each([
      ['テキストでない中身', 'a.md', Uint8Array.from([0xff, 0xfe, 0x00])],
      ['取り込めない拡張子', 'a.pdf', new TextEncoder().encode('x')],
      ['空のファイル', 'a.md', new TextEncoder().encode('  \n')],
    ])('%s は 400 で、何も保存しない', async (_label, name, content) => {
      const res = await POST(uploadRequest(name, content));
      expect(res.status).toBe(400);
      expect(await prisma.knowledgeDocument.count()).toBe(0);
    });

    it('multipart でないボディ・file の無いボディは 400', async () => {
      const notForm = new NextRequest(URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect((await POST(notForm)).status).toBe(400);

      const form = new FormData();
      form.append('other', 'x');
      const noFile = new NextRequest(URL, { method: 'POST', body: form });
      expect((await POST(noFile)).status).toBe(400);
    });

    it('埋め込みのモデルが無ければ 502 で ollama pull を案内する', async () => {
      stubEmbed(
        1,
        Response.json({ error: "model 'x' not found" }, { status: 404 })
      );
      const res = await POST(uploadRequest('a.md', 'x'));
      expect(res.status).toBe(502);
      expect((await res.json()).error).toContain(
        `ollama pull ${getEmbeddingModel()}`
      );
    });

    it('Ollama に繋がらなければ 502', async () => {
      stubEmbed(1);
      const res = await POST(uploadRequest('a.md', 'x'));
      expect(res.status).toBe(502);
      expect((await res.json()).error).toContain('埋め込みを作れませんでした');
    });

    it('埋め込みの数が合わない応答は 502', async () => {
      stubFetch(() => Response.json({ embeddings: [[1, 2]] }));
      const res = await POST(uploadRequest('a.md', '# A\n\nx\n\n# B\n\ny'));
      expect(res.status).toBe(502);
    });

    it('途中の埋め込みで失敗すると何も残さず、置き換えでは元のチャンクが残る', async () => {
      const paragraphs = Array.from(
        { length: 40 },
        (_, i) => `## 節${i}\n\n本文${i}`
      );
      const md = paragraphs.join('\n\n');

      stubEmbed(2);
      expect((await POST(uploadRequest('多い.md', md))).status).toBe(502);
      expect(await prisma.knowledgeDocument.count()).toBe(0);

      stubEmbed();
      const { document } = await (
        await POST(uploadRequest('多い.md', md))
      ).json();
      stubEmbed(2);
      expect(
        (await POST(uploadRequest('多い.md', `${md}\n\n## 追加\n\n本文`)))
          .status
      ).toBe(502);
      expect(await chunksOf(document.id)).toHaveLength(40);
    });
  });
});

describe('POST /api/knowledge/documents/[id]/rebuild', () => {
  describe('正常系', () => {
    it('モデルが違うドキュメントは needsRebuild になり、作り直すと今のモデルに戻る', async () => {
      const { document } = await (
        await POST(uploadRequest('a.md', DESIGN_MD))
      ).json();
      await prisma.knowledgeDocument.update({
        where: { id: document.id },
        data: { embeddingModel: 'old-model:1b' },
      });

      const listed = await (await GET()).json();
      expect(listed.documents[0]).toMatchObject({
        embeddingModel: 'old-model:1b',
        needsRebuild: true,
      });

      stubEmbed();
      const res = await REBUILD(
        new NextRequest(`${URL}/${document.id}/rebuild`, { method: 'POST' }),
        routeContext(document.id)
      );
      expect(res.status).toBe(200);
      expect((await res.json()).document).toMatchObject({
        id: document.id,
        embeddingModel: getEmbeddingModel(),
        needsRebuild: false,
        chunkCount: 3,
      });
      // 保存した本文から作り直す
      expect(embedInputs).toHaveLength(1);
      expect(await chunksOf(document.id)).toHaveLength(3);
    });
  });

  describe('準正常系', () => {
    it('無いドキュメントは 404', async () => {
      const res = await REBUILD(
        new NextRequest(`${URL}/${NONEXISTENT}/rebuild`, { method: 'POST' }),
        routeContext(NONEXISTENT)
      );
      expect(res.status).toBe(404);
    });
  });

  describe('異常系', () => {
    it('ID の形が不正なら 400', async () => {
      const res = await REBUILD(
        new NextRequest(`${URL}/x/rebuild`, { method: 'POST' }),
        routeContext('not-a-uuid')
      );
      expect(res.status).toBe(400);
    });

    it('作り直しの埋め込みに失敗したら 502 で、元のチャンクとモデルが残る', async () => {
      const { document } = await (
        await POST(uploadRequest('a.md', DESIGN_MD))
      ).json();
      await prisma.knowledgeDocument.update({
        where: { id: document.id },
        data: { embeddingModel: 'old-model:1b' },
      });

      stubEmbed(1);
      const res = await REBUILD(
        new NextRequest(`${URL}/${document.id}/rebuild`, { method: 'POST' }),
        routeContext(document.id)
      );
      expect(res.status).toBe(502);
      const saved = await prisma.knowledgeDocument.findUnique({
        where: { id: document.id },
      });
      expect(saved?.embeddingModel).toBe('old-model:1b');
      expect(await chunksOf(document.id)).toHaveLength(3);
    });
  });
});

describe('DELETE /api/knowledge/documents/[id]', () => {
  describe('正常系', () => {
    it('削除するとチャンクもカスケードで消える', async () => {
      const { document } = await (
        await POST(uploadRequest('a.md', DESIGN_MD))
      ).json();
      const res = await DELETE(
        new NextRequest(`${URL}/${document.id}`, { method: 'DELETE' }),
        routeContext(document.id)
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(await prisma.knowledgeDocument.count()).toBe(0);
      expect(await prisma.knowledgeChunk.count()).toBe(0);
    });
  });

  describe('準正常系', () => {
    it('無いドキュメントは 404', async () => {
      const res = await DELETE(
        new NextRequest(`${URL}/${NONEXISTENT}`, { method: 'DELETE' }),
        routeContext(NONEXISTENT)
      );
      expect(res.status).toBe(404);
    });
  });

  describe('異常系', () => {
    it('ID の形が不正なら 400', async () => {
      const res = await DELETE(
        new NextRequest(`${URL}/x`, { method: 'DELETE' }),
        routeContext('not-a-uuid')
      );
      expect(res.status).toBe(400);
    });
  });
});
