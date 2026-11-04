import {
  describe,
  it,
  expect,
  beforeEach,
  afterAll,
  afterEach,
  vi,
} from 'vitest';
import { randomUUID } from 'node:crypto';
import { POST } from '@/app/api/chat/route';
import type { AgentStreamEvent } from '@/lib/agent/tools/types';
import { getEmbeddingModel } from '@/lib/llm/ollama';
import type { OllamaChatMessage } from '@/lib/llm/ollama';
import type { KnowledgeSource } from '@/types/knowledge/document';
import { prisma, resetDb, jsonRequest } from './helpers/db';
import { ollamaStreamResponse, stubFetch } from './helpers/ollama-stub';

/**
 * `/api/chat` の `knowledgeEnabled`（RAG の会話での参照。#17 Phase B）の IT。
 *
 * 実 PostgreSQL（pgvector）に、類似度の分かっている埋め込みのチャンクを直接入れ、近い順・しきい値・違うモデルを
 * 比べないこと・システムプロンプトへの入れ方・出典のイベント・エージェントモードで外部のツールを止めることを確かめる。
 * Ollama の `/api/embed`・`/api/chat` と、止めるはずの外部への通信だけをスタブにする（真の外部）。
 */
const URL = 'http://localhost/api/chat';
/** url_fetch の取得先（文書用アドレス。実行されれば fetch スタブに届く） */
const TARGET_URL = 'http://203.0.113.10/collect';

/** 質問の埋め込み（スタブはどの質問にもこれを返す）。チャンクの埋め込みとのコサイン類似度が、そのまま第 1 成分になる */
const QUERY_VECTOR = [1, 0, 0, 0];

/**
 * 質問とのコサイン類似度が `similarity` になる、長さ 1 の埋め込みを作る。
 *
 * @param similarity - 質問との類似度（-1〜1）
 * @returns 4 次元の埋め込み
 */
function vectorWith(similarity: number): number[] {
  return [similarity, Math.sqrt(1 - similarity ** 2), 0, 0];
}

/** 入れるチャンク */
type ChunkSeed = {
  heading: string;
  content: string;
  similarity: number;
};

/**
 * ドキュメントとチャンクを DB に直接入れる（取り込みの API を通さず、埋め込みを決めて入れるため）。
 *
 * @param name - ドキュメントの名前
 * @param chunks - チャンク（並び順）
 * @param embeddingModel - 埋め込みを作ったモデル（省略時は今のモデル）
 */
async function seedDocument(
  name: string,
  chunks: ChunkSeed[],
  embeddingModel = getEmbeddingModel()
) {
  const content = chunks.map((chunk) => chunk.content).join('\n\n');
  const document = await prisma.knowledgeDocument.create({
    data: {
      name,
      content,
      size: new TextEncoder().encode(content).byteLength,
      embeddingModel,
    },
  });
  for (const [position, chunk] of chunks.entries()) {
    const literal = `[${vectorWith(chunk.similarity).join(',')}]`;
    await prisma.$executeRaw`INSERT INTO "KnowledgeChunk" ("id", "documentId", "position", "heading", "content", "embedding") VALUES (${randomUUID()}, ${document.id}, ${position}, ${chunk.heading}, ${chunk.content}, ${literal}::vector)`;
  }
}

/** スタブが受けた Ollama・外部への呼び出し */
type Calls = {
  /** `/api/embed` に送られた入力 */
  embed: string[][];
  /** `/api/chat` に送られた会話（ラウンドごと） */
  chat: OllamaChatMessage[][];
  /** Ollama 以外へ届いた URL（止めるはずの外部への通信） */
  external: string[];
};

/** LLM が要求するツール呼び出し（ツール名と引数） */
type ToolCallSpec = { name: string; arguments: Record<string, unknown> };

/**
 * ツール呼び出しを要求する Ollama の応答を作る（tool_calls は done=true のチャンクに含まれる）。
 *
 * @param calls - LLM が同時に要求するツール呼び出し
 * @returns NDJSON の `Response`
 */
function ollamaToolCallResponse(calls: ToolCallSpec[]): Response {
  const line = JSON.stringify({
    model: 'test',
    message: {
      role: 'assistant',
      content: '',
      tool_calls: calls.map((call) => ({ function: call })),
    },
    done: true,
  });
  return new Response(line + '\n', {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' },
  });
}

/**
 * Ollama と外部への通信をスタブにする。
 *
 * @param options - `rounds` はエージェントのラウンドごとに LLM が要求するツール呼び出し（使い切ったら最終回答）、
 *   `embedFailure` は `/api/embed` の失敗（応答を返すか、例外にする）
 * @returns 呼び出しの記録
 */
function stubOllama(
  options: {
    rounds?: ToolCallSpec[][];
    embedFailure?: Response | 'network';
  } = {}
): Calls {
  const calls: Calls = { embed: [], chat: [], external: [] };
  stubFetch(async (url, init) => {
    if (url.endsWith('/api/embed')) {
      // ボディは embed()（lib/llm/ollama.ts）が JSON.stringify した { model, input } で、形はアプリが決めている
      const { input } = JSON.parse(String(init?.body)) as { input: string[] };
      calls.embed.push(input);
      if (options.embedFailure === 'network') {
        throw new TypeError('fetch failed');
      }
      if (options.embedFailure) return options.embedFailure;
      return Response.json({ embeddings: input.map(() => QUERY_VECTOR) });
    }
    if (url.endsWith('/api/chat')) {
      // ボディは streamChat() が JSON.stringify した { model, messages, … }
      const { messages } = JSON.parse(String(init?.body)) as {
        messages: OllamaChatMessage[];
      };
      calls.chat.push(messages);
      const round = options.rounds?.[calls.chat.length - 1];
      return round
        ? ollamaToolCallResponse(round)
        : ollamaStreamResponse(['回答']);
    }
    calls.external.push(url);
    return new Response('送信されました', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
  });
  return calls;
}

/**
 * 送信して NDJSON のイベント列を読み切る。
 *
 * @param body - `/api/chat` のボディ（`message` は既定で「範囲は？」）
 * @returns 受信したイベント（受信順）
 */
async function send(
  body: Record<string, unknown>
): Promise<AgentStreamEvent[]> {
  const res = await POST(
    jsonRequest(URL, 'POST', { message: '範囲は？', ...body })
  );
  expect(res.status).toBe(200);
  return (await res.text())
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as AgentStreamEvent);
}

/**
 * イベント列から出典を取り出す。
 *
 * @param events - イベント列
 * @returns `knowledge_sources` の出典（無ければ undefined）
 */
function sourcesOf(events: AgentStreamEvent[]): KnowledgeSource[] | undefined {
  const event = events.find(
    (e): e is Extract<AgentStreamEvent, { type: 'knowledge_sources' }> =>
      e.type === 'knowledge_sources'
  );
  return event?.sources;
}

/**
 * Ollama へ送った最初のラウンドのシステムプロンプトを取り出す。
 *
 * @param calls - スタブの記録
 * @returns 先頭の system メッセージの本文
 */
function systemPromptOf(calls: Calls): string {
  const [first] = calls.chat[0];
  expect(first.role).toBe('system');
  return first.content;
}

beforeEach(async () => {
  await resetDb();
  await seedDocument('設計書.md', [
    { heading: '範囲', content: '会話ごとに切り替える。', similarity: 0.9 },
    { heading: 'データ', content: '表の説明', similarity: 0.3 },
  ]);
  await seedDocument('メモ.txt', [
    { heading: '', content: 'メモの本文', similarity: 0.6 },
  ]);
  // 違うモデルで作ったドキュメントは、どれだけ近くても比べない
  await seedDocument(
    '古い.md',
    [{ heading: '', content: '古い本文', similarity: 1 }],
    'other-embedding-model'
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

describe('POST /api/chat（knowledgeEnabled）', () => {
  describe('正常系', () => {
    it('今のモデルのチャンクを近い順に探し、しきい値未満を外して、出典を最初に送る', async () => {
      const calls = stubOllama();

      const events = await send({ knowledgeEnabled: true });

      expect(events[0].type).toBe('knowledge_sources');
      const sources = sourcesOf(events)!;
      expect(
        sources.map((s) => [s.documentName, s.heading, s.excerpt])
      ).toEqual([
        ['設計書.md', '範囲', '会話ごとに切り替える。'],
        ['メモ.txt', '', 'メモの本文'],
      ]);
      expect(sources[0].similarity).toBeCloseTo(0.9, 5);
      expect(sources[1].similarity).toBeCloseTo(0.6, 5);
      // 質問は既定のモデル（embeddinggemma）の検索の前置きを付けて埋め込む
      expect(calls.embed).toEqual([['task: search result | query: 範囲は？']]);
      expect(events.map((e) => e.type)).toEqual([
        'knowledge_sources',
        'text_delta',
        'done',
      ]);
    });

    it('抜き出しを役割の後・現在の日時の前に入れる', async () => {
      const calls = stubOllama();

      await send({
        knowledgeEnabled: true,
        systemPrompt: 'あなたは設計者です',
      });

      const prompt = systemPromptOf(calls);
      expect(prompt.indexOf('あなたは設計者です')).toBe(0);
      const knowledgeAt = prompt.indexOf('## 参照するドキュメント');
      expect(knowledgeAt).toBeGreaterThan(0);
      expect(prompt.indexOf('## 現在の日時')).toBeGreaterThan(knowledgeAt);
      expect(prompt).toContain(
        '### [1] 設計書.md > 範囲\n会話ごとに切り替える。'
      );
      expect(prompt).toContain('### [2] メモ.txt\nメモの本文');
      expect(prompt).not.toContain('表の説明');
      expect(prompt).not.toContain('古い本文');
    });

    it('エージェントモードでも出典を最初に送る', async () => {
      stubOllama();

      const events = await send({ knowledgeEnabled: true, enableTools: true });

      expect(events[0].type).toBe('knowledge_sources');
      expect(sourcesOf(events)).toHaveLength(2);
      expect(events.at(-1)?.type).toBe('done');
    });

    it('近いチャンクが多くても 5 件までにする', async () => {
      await seedDocument(
        '多い.md',
        Array.from({ length: 6 }, (_, i) => ({
          heading: `節${i}`,
          content: `本文${i}`,
          similarity: 0.8 - i * 0.01,
        }))
      );
      stubOllama();

      const sources = sourcesOf(await send({ knowledgeEnabled: true }))!;

      expect(sources.map((s) => s.heading)).toEqual([
        '範囲',
        '節0',
        '節1',
        '節2',
        '節3',
      ]);
    });
  });

  describe('準正常系', () => {
    it('見つからなければ空の出典を送り、システムプロンプトに何も足さない', async () => {
      await prisma.knowledgeDocument.deleteMany({
        where: { name: { in: ['設計書.md', 'メモ.txt'] } },
      });
      await seedDocument('遠い.md', [
        { heading: '', content: '関係ない', similarity: 0.39 },
      ]);
      const calls = stubOllama();

      const events = await send({ knowledgeEnabled: true });

      expect(sourcesOf(events)).toEqual([]);
      expect(systemPromptOf(calls)).not.toContain('## 参照するドキュメント');
    });

    it('今のモデルのドキュメントが無ければ、埋め込みを作らずに空の出典を送る', async () => {
      await prisma.knowledgeDocument.deleteMany({
        where: { name: { in: ['設計書.md', 'メモ.txt'] } },
      });
      const calls = stubOllama();

      const events = await send({ knowledgeEnabled: true });

      expect(sourcesOf(events)).toEqual([]);
      expect(calls.embed).toEqual([]);
    });

    it('knowledgeEnabled が無ければ探さず、出典も送らない', async () => {
      const calls = stubOllama();

      const events = await send({});

      expect(sourcesOf(events)).toBeUndefined();
      expect(calls.embed).toEqual([]);
      expect(systemPromptOf(calls)).not.toContain('## 参照するドキュメント');
    });

    it('履歴の前の質問ではなく、今回のメッセージで探す', async () => {
      const calls = stubOllama();

      await send({
        knowledgeEnabled: true,
        message: '今回の質問',
        conversationHistory: [
          { role: 'user', content: '前の質問' },
          { role: 'assistant', content: '前の回答' },
        ],
      });

      expect(calls.embed).toEqual([
        ['task: search result | query: 今回の質問'],
      ]);
    });

    it('エージェントモードで見つからなかった応答では、外部のツールを止めない', async () => {
      await prisma.knowledgeDocument.deleteMany();
      const calls = stubOllama({
        rounds: [[{ name: 'url_fetch', arguments: { url: TARGET_URL } }]],
      });

      const events = await send({ knowledgeEnabled: true, enableTools: true });

      expect(sourcesOf(events)).toEqual([]);
      expect(calls.external).toEqual([TARGET_URL]);
    });
  });

  describe('異常系', () => {
    it('エージェントモードで抜き出しを渡した応答では、外部と通信するツールを実行しない', async () => {
      const calls = stubOllama({
        rounds: [
          [
            { name: 'url_fetch', arguments: { url: `${TARGET_URL}?q=範囲` } },
            {
              name: 'web_search',
              arguments: { query: '会話ごとに切り替える' },
            },
          ],
        ],
      });

      const events = await send({ knowledgeEnabled: true, enableTools: true });

      // 取得先にも SearXNG にも届かない
      expect(calls.external).toEqual([]);
      for (const name of ['url_fetch', 'web_search']) {
        const result = events.find(
          (e): e is Extract<AgentStreamEvent, { type: 'tool_call_result' }> =>
            e.type === 'tool_call_result' && e.name === name
        );
        expect(result).toMatchObject({
          isError: true,
          summary:
            '実行しませんでした（ローカルのファイル・コマンドの出力・GitHub の内容・登録したドキュメント・別の MCP のサーバーの内容を読んだ後のため）',
        });
      }
      expect(events.at(-1)?.type).toBe('done');
    });

    it('埋め込みのモデルが無ければ 502 で ollama pull を案内し、応答を始めない', async () => {
      const calls = stubOllama({
        embedFailure: Response.json(
          { error: `model '${getEmbeddingModel()}' not found` },
          { status: 404 }
        ),
      });

      const res = await POST(
        jsonRequest(URL, 'POST', {
          message: '範囲は？',
          knowledgeEnabled: true,
        })
      );

      expect(res.status).toBe(502);
      expect((await res.json()).error).toBe(
        `埋め込みのモデル（${getEmbeddingModel()}）がありません。ollama pull ${getEmbeddingModel()} を実行してください`
      );
      expect(calls.chat).toEqual([]);
    });

    it('Ollama に繋がらず埋め込みを作れなければ 502 で、応答を始めない', async () => {
      const calls = stubOllama({ embedFailure: 'network' });

      const res = await POST(
        jsonRequest(URL, 'POST', {
          message: '範囲は？',
          knowledgeEnabled: true,
        })
      );

      expect(res.status).toBe(502);
      expect((await res.json()).error).toContain('埋め込みを作れませんでした');
      expect(calls.chat).toEqual([]);
    });

    it('knowledgeEnabled が真偽値でなければ 400 で、探さない', async () => {
      const calls = stubOllama();

      const res = await POST(
        jsonRequest(URL, 'POST', {
          message: '範囲は？',
          knowledgeEnabled: 'yes',
        })
      );

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(
        'knowledgeEnabledは真偽値で指定してください'
      );
      expect(calls.embed).toEqual([]);
    });

    it('DB の検索に失敗すると 500 で、応答を始めない', async () => {
      // Prisma をモックせず、実 DB 側でチャンクの表を読めなくする（conversation-update.test.ts の障害注入と同じ考え）
      await prisma.$executeRaw`ALTER TABLE "KnowledgeChunk" RENAME TO "KnowledgeChunkHidden"`;
      try {
        const calls = stubOllama();

        const res = await POST(
          jsonRequest(URL, 'POST', {
            message: '範囲は？',
            knowledgeEnabled: true,
          })
        );

        expect(res.status).toBe(500);
        expect((await res.json()).error).toBe(
          'ドキュメントの検索に失敗しました'
        );
        expect(calls.chat).toEqual([]);
      } finally {
        await prisma.$executeRaw`ALTER TABLE "KnowledgeChunkHidden" RENAME TO "KnowledgeChunk"`;
      }
    });
  });
});
