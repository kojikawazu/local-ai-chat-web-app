import { describe, it, expect, afterEach, vi } from 'vitest';
import { POST } from '@/app/api/chat/route';
import { jsonRequest } from './helpers/db';
import { ollamaStreamResponse, stubFetch } from './helpers/ollama-stub';

/**
 * `/api/chat`（非エージェント経路）の IT。
 * Ollama は真の外部のため fetch をスタブし、handler↔ollama.ts↔ストリーミング中継の
 * 配線と、エラー時の HTTP 契約（E2E から移譲した 502 系）を決定的に検証する。
 * この経路は DB を使わないため Prisma には触れない。
 */
const URL = 'http://localhost/api/chat';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/chat（通常チャット）', () => {
  describe('正常系', () => {
    it('Ollama のストリーミング応答を中継して 200 とテキストを返す', async () => {
      stubFetch(() => ollamaStreamResponse(['こん', 'にちは']));

      const res = await POST(jsonRequest(URL, 'POST', { message: 'やあ', enableTools: false }));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('こんにちは');
    });
  });

  describe('準正常系', () => {
    it('conversationHistory を含めて Ollama にリクエストを送る', async () => {
      const fetchMock = stubFetch(() => ollamaStreamResponse(['ok']));

      const res = await POST(
        jsonRequest(URL, 'POST', {
          message: '次は？',
          conversationHistory: [{ role: 'user', content: '前の発言' }],
          enableTools: false,
        }),
      );
      expect(res.status).toBe(200);

      // Ollama へ渡された body に履歴＋今回のメッセージが時系列で含まれる
      const [, init] = fetchMock.mock.calls[0];
      const sent = JSON.parse(init!.body as string);
      expect(sent.messages).toEqual([
        { role: 'user', content: '前の発言' },
        { role: 'user', content: '次は？' },
      ]);
    });
  });

  describe('異常系', () => {
    it('Ollama への接続に失敗すると 502 を返す（E2E から移譲したエラー契約）', async () => {
      stubFetch(() => {
        throw new Error('ECONNREFUSED');
      });

      const res = await POST(jsonRequest(URL, 'POST', { message: 'やあ', enableTools: false }));
      expect(res.status).toBe(502);
      expect((await res.json()).error).toContain('Ollama');
    });

    it('Ollama が非 2xx を返すと 502 を返す', async () => {
      stubFetch(() => new Response('boom', { status: 500 }));

      const res = await POST(jsonRequest(URL, 'POST', { message: 'やあ', enableTools: false }));
      expect(res.status).toBe(502);
    });

    it('空メッセージは 400。Ollama へは到達しない', async () => {
      const fetchMock = stubFetch(() => ollamaStreamResponse(['x']));

      const res = await POST(jsonRequest(URL, 'POST', { message: '   ', enableTools: false }));
      expect(res.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('10,000 文字超のメッセージは 400', async () => {
      stubFetch(() => ollamaStreamResponse(['x']));

      const res = await POST(
        jsonRequest(URL, 'POST', { message: 'あ'.repeat(10001), enableTools: false }),
      );
      expect(res.status).toBe(400);
    });

    it('不正な JSON ボディは 400', async () => {
      const res = await POST(jsonRequest(URL, 'POST', 'not-json'));
      expect(res.status).toBe(400);
    });
  });
});
