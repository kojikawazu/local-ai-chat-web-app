import { describe, it, expect, afterEach, vi } from 'vitest';
import { POST } from '@/app/api/chat/route';
import { jsonRequest } from './helpers/db';
import {
  ollamaChunksResponse,
  ollamaStreamResponse,
  stubFetch,
} from './helpers/ollama-stub';

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

      const res = await POST(
        jsonRequest(URL, 'POST', { message: 'やあ', enableTools: false })
      );
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('こんにちは');
    });

    it('Ollama に think: false を送り、思考させずに答えさせる', async () => {
      // 思考に対応したモデルは既定で考えてから答え、最初の文字まで数秒かかるため（#116）
      const fetchMock = stubFetch(() => ollamaStreamResponse(['ok']));

      await POST(
        jsonRequest(URL, 'POST', { message: 'やあ', enableTools: false })
      );

      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init!.body as string).think).toBe(false);
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
        })
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

    it('systemPrompt（会話の役割）を先頭の system メッセージとして Ollama へ渡す（#10）', async () => {
      const fetchMock = stubFetch(() => ollamaStreamResponse(['ok']));

      const res = await POST(
        jsonRequest(URL, 'POST', {
          message: 'Hello',
          conversationHistory: [{ role: 'user', content: '前の発言' }],
          enableTools: false,
          systemPrompt: ' あなたは翻訳者です。 ',
        })
      );
      expect(res.status).toBe(200);

      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init!.body as string).messages).toEqual([
        { role: 'system', content: 'あなたは翻訳者です。' },
        { role: 'user', content: '前の発言' },
        { role: 'user', content: 'Hello' },
      ]);
    });

    it('systemPrompt が空白のみなら system メッセージを付けない', async () => {
      const fetchMock = stubFetch(() => ollamaStreamResponse(['ok']));

      await POST(
        jsonRequest(URL, 'POST', {
          message: 'Hello',
          enableTools: false,
          systemPrompt: '  ',
        })
      );

      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init!.body as string).messages).toEqual([
        { role: 'user', content: 'Hello' },
      ]);
    });

    it('履歴の要素は role と content だけを Ollama へ渡す（tool_calls 等の余分な項目は落とす）', async () => {
      const fetchMock = stubFetch(() => ollamaStreamResponse(['ok']));

      await POST(
        jsonRequest(URL, 'POST', {
          message: '次は？',
          conversationHistory: [
            {
              role: 'assistant',
              content: '前の回答',
              tool_calls: [{ function: { name: 'x', arguments: {} } }],
            },
          ],
        })
      );

      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init!.body as string).messages[0]).toEqual({
        role: 'assistant',
        content: '前の回答',
      });
    });

    it('応答に思考過程（message.thinking）が混ざっても本文だけを中継する', async () => {
      // think: false を無視して思考を返すモデルでも、思考が本文に混ざらないこと
      stubFetch(() =>
        ollamaChunksResponse([
          { thinking: '挨拶を' },
          { thinking: '返す' },
          { content: 'こんにちは' },
        ])
      );

      const res = await POST(
        jsonRequest(URL, 'POST', { message: 'やあ', enableTools: false })
      );
      expect(await res.text()).toBe('こんにちは');
    });
  });

  describe('異常系', () => {
    it('Ollama への接続に失敗すると 502 を返す（E2E から移譲したエラー契約）', async () => {
      stubFetch(() => {
        throw new Error('ECONNREFUSED');
      });

      const res = await POST(
        jsonRequest(URL, 'POST', { message: 'やあ', enableTools: false })
      );
      expect(res.status).toBe(502);
      expect((await res.json()).error).toContain('Ollama');
    });

    it('Ollama が非 2xx を返すと 502 を返す', async () => {
      stubFetch(() => new Response('boom', { status: 500 }));

      const res = await POST(
        jsonRequest(URL, 'POST', { message: 'やあ', enableTools: false })
      );
      expect(res.status).toBe(502);
    });

    it('空メッセージは 400。Ollama へは到達しない', async () => {
      const fetchMock = stubFetch(() => ollamaStreamResponse(['x']));

      const res = await POST(
        jsonRequest(URL, 'POST', { message: '   ', enableTools: false })
      );
      expect(res.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('10,000 文字超のメッセージは 400', async () => {
      stubFetch(() => ollamaStreamResponse(['x']));

      const res = await POST(
        jsonRequest(URL, 'POST', {
          message: 'あ'.repeat(10001),
          enableTools: false,
        })
      );
      expect(res.status).toBe(400);
    });

    it('不正な JSON ボディは 400', async () => {
      const res = await POST(jsonRequest(URL, 'POST', 'not-json'));
      expect(res.status).toBe(400);
    });

    // 以下は JSON としては正しいが API の形に合わないボディ（#95）。
    // 以前は分割代入や spread が TypeError を投げて 500 になっていた
    it.each([
      ['ボディが null', null],
      ['ボディが配列', [{ message: 'やあ' }]],
      [
        'conversationHistory がオブジェクト',
        { message: 'やあ', conversationHistory: {} },
      ],
      [
        '履歴の role が system',
        {
          message: 'やあ',
          conversationHistory: [{ role: 'system', content: '指示' }],
        },
      ],
      [
        '履歴の content が数値',
        {
          message: 'やあ',
          conversationHistory: [{ role: 'user', content: 1 }],
        },
      ],
      ['model が数値', { message: 'やあ', model: 1 }],
      ['enableTools が文字列', { message: 'やあ', enableTools: 'true' }],
      ['systemPrompt が数値', { message: 'やあ', systemPrompt: 1 }],
    ])(
      '%sなら 400 と { error }。Ollama へは到達しない',
      async (_label, body) => {
        const fetchMock = stubFetch(() => ollamaStreamResponse(['x']));

        const res = await POST(jsonRequest(URL, 'POST', body));
        expect(res.status).toBe(400);
        expect(typeof (await res.json()).error).toBe('string');
        expect(fetchMock).not.toHaveBeenCalled();
      }
    );
  });
});
