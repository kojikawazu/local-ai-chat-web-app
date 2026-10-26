import {
  describe,
  it,
  expect,
  beforeEach,
  afterAll,
  afterEach,
  vi,
} from 'vitest';
import { POST } from '@/app/api/chat/route';
import { prisma, resetDb, jsonRequest } from './helpers/db';
import { ollamaStreamResponse, stubFetch } from './helpers/ollama-stub';

/**
 * `/api/chat` の添付画像（#6）の IT。
 * 添付は実 DB に置き、Ollama（`/api/show`・`/api/chat`）だけを fetch スタブで差し替える。
 * ID で届いた画像を DB から読んで Ollama の `images` へ渡す配線と、非対応モデル・見つからない ID の
 * エラー契約を検証する。
 */
const URL = 'http://localhost/api/chat';

/** 先頭だけが PNG のシグネチャのバイト列（中身の判定は保存時だけで、ここでは描画しない）。 */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x07,
]);
const PNG_BASE64 = Buffer.from(PNG_BYTES).toString('base64');

/** Ollama の `/api/chat` に送られたボディ。 */
type SentBody = {
  model: string;
  messages: { role: string; content: string; images?: string[] }[];
};

/**
 * Ollama をスタブする。`/api/show` はモデルの対応機能を、`/api/chat` は短い応答を返す。
 *
 * @param capabilities - `/api/show` が返す対応機能。`null` なら `/api/show` を 500 にする
 * @returns fetch のモック（`/api/chat` に送られたボディの取り出しに使う）
 */
function stubOllama(capabilities: string[] | null) {
  return stubFetch((url) => {
    if (url.endsWith('/api/show')) {
      return capabilities
        ? new Response(JSON.stringify({ capabilities }), { status: 200 })
        : new Response('boom', { status: 500 });
    }
    return ollamaStreamResponse(['ok']);
  });
}

/**
 * fetch のモックから、Ollama の `/api/chat` に送られたボディを取り出す。
 *
 * @param mock - {@link stubOllama} の戻り値
 * @returns 送られたボディ。`/api/chat` が呼ばれていなければ `undefined`
 */
function sentChatBody(
  mock: ReturnType<typeof stubOllama>
): SentBody | undefined {
  const call = mock.mock.calls.find(([url]) =>
    String(url).endsWith('/api/chat')
  );
  return call ? JSON.parse(call[1]!.body as string) : undefined;
}

/**
 * 添付付きの user メッセージを DB に作り、添付の ID を返す。
 *
 * @param count - 添付の枚数
 * @returns 作った添付の ID（並び順）
 */
async function createImages(count: number): Promise<string[]> {
  const conv = await prisma.conversation.create({ data: { title: '画像' } });
  const ids = Array.from({ length: count }, () => crypto.randomUUID());
  await prisma.message.create({
    data: {
      conversationId: conv.id,
      role: 'user',
      content: '画像',
      attachments: {
        create: ids.map((id, position) => ({
          id,
          position,
          mimeType: 'image/png',
          width: 1,
          height: 1,
          size: PNG_BYTES.length,
          data: PNG_BYTES,
        })),
      },
    },
  });
  return ids;
}

beforeEach(async () => {
  await resetDb();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /api/chat（添付画像）', () => {
  describe('正常系', () => {
    it('送信する質問の画像を DB から読み、Base64 にして Ollama の images へ渡す', async () => {
      const [imageId] = await createImages(1);
      const mock = stubOllama(['completion', 'vision']);

      const res = await POST(
        jsonRequest(URL, 'POST', { message: 'これは？', imageIds: [imageId] })
      );
      expect(res.status).toBe(200);
      const last = sentChatBody(mock)!.messages.at(-1)!;
      expect(last).toEqual({
        role: 'user',
        content: 'これは？',
        images: [PNG_BASE64],
      });
    });

    it('履歴の user の画像も渡す', async () => {
      const [past] = await createImages(1);
      const mock = stubOllama(['vision']);

      await POST(
        jsonRequest(URL, 'POST', {
          message: '右上は？',
          conversationHistory: [
            { role: 'user', content: 'これは？', imageIds: [past] },
            { role: 'assistant', content: '猫です' },
          ],
        })
      );
      const messages = sentChatBody(mock)!.messages;
      expect(messages.find((m) => m.content === 'これは？')?.images).toEqual([
        PNG_BASE64,
      ]);
    });

    it('エージェントモードでも images を渡す', async () => {
      const [imageId] = await createImages(1);
      const mock = stubOllama(['vision', 'tools']);

      const res = await POST(
        jsonRequest(URL, 'POST', {
          message: 'これは？',
          imageIds: [imageId],
          enableTools: true,
        })
      );
      await res.text();
      expect(sentChatBody(mock)!.messages.at(-1)!.images).toEqual([PNG_BASE64]);
    });
  });

  describe('準正常系', () => {
    it('画像が無ければ Ollama の /api/show を呼ばない（画像を使わない会話の処理を変えない）', async () => {
      const mock = stubOllama(['completion']);

      await POST(jsonRequest(URL, 'POST', { message: 'やあ' }));
      expect(
        mock.mock.calls.some(([url]) => String(url).endsWith('/api/show'))
      ).toBe(false);
      expect(sentChatBody(mock)!.messages.at(-1)).toEqual({
        role: 'user',
        content: 'やあ',
      });
    });

    it('非対応モデルで履歴にだけ画像があれば、画像を外して注記を足して続ける', async () => {
      const [past] = await createImages(1);
      const mock = stubOllama(['completion']);

      const res = await POST(
        jsonRequest(URL, 'POST', {
          message: '続きは？',
          conversationHistory: [
            { role: 'user', content: 'これは？', imageIds: [past] },
          ],
        })
      );
      expect(res.status).toBe(200);
      const first = sentChatBody(mock)!.messages.find((m) =>
        m.content.startsWith('これは？')
      )!;
      expect(first.images).toBeUndefined();
      expect(first.content).toBe(
        'これは？\n\n（画像 1 枚を添付。このモデルは画像に対応していないため省略）'
      );
    });

    it('上限を超える履歴の画像は古いものから外し、注記を足す', async () => {
      const old = await createImages(4);
      const recent = await createImages(4);
      const current = await createImages(1);
      const mock = stubOllama(['vision']);

      await POST(
        jsonRequest(URL, 'POST', {
          message: '比べて',
          imageIds: current,
          conversationHistory: [
            { role: 'user', content: '古い', imageIds: old },
            { role: 'user', content: '新しい', imageIds: recent },
          ],
        })
      );
      const messages = sentChatBody(mock)!.messages;
      const oldMessage = messages.find((m) => m.content.startsWith('古い'))!;
      expect(oldMessage.images).toBeUndefined();
      expect(oldMessage.content).toBe(
        '古い\n\n（画像 4 枚を添付。古いため省略）'
      );
      expect(messages.find((m) => m.content === '新しい')?.images).toHaveLength(
        4
      );
      expect(messages.at(-1)?.images).toHaveLength(1);
    });
  });

  describe('異常系', () => {
    it('非対応モデルへ送信する質問に画像があれば 400 で、Ollama の /api/chat を呼ばない', async () => {
      const [imageId] = await createImages(1);
      const mock = stubOllama(['completion', 'tools']);

      const res = await POST(
        jsonRequest(URL, 'POST', {
          message: 'これは？',
          imageIds: [imageId],
          model: 'qwen2.5:0.5b',
        })
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: '選択中のモデル（qwen2.5:0.5b）は画像に対応していません',
      });
      expect(sentChatBody(mock)).toBeUndefined();
    });

    it('存在しない添付の ID は 400', async () => {
      stubOllama(['vision']);

      const res = await POST(
        jsonRequest(URL, 'POST', {
          message: 'これは？',
          imageIds: [crypto.randomUUID()],
        })
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: '画像が見つかりません' });
    });

    it('モデルの対応機能を問い合わせられなければ 502', async () => {
      const [imageId] = await createImages(1);
      stubOllama(null);

      const res = await POST(
        jsonRequest(URL, 'POST', { message: 'これは？', imageIds: [imageId] })
      );
      expect(res.status).toBe(502);
      expect((await res.json()).error).toMatch(/^Ollamaへの接続に失敗しました/);
    });

    it('imageIds の形式が不正なら 400 で、Ollama を呼ばない', async () => {
      const mock = stubOllama(['vision']);

      const res = await POST(
        jsonRequest(URL, 'POST', { message: 'これは？', imageIds: ['x'] })
      );
      expect(res.status).toBe(400);
      expect(mock).not.toHaveBeenCalled();
    });
  });
});
