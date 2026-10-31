import { describe, it, expect, afterEach, vi } from 'vitest';
import { POST } from '@/app/api/chat/route';
import type { AgentStreamEvent } from '@/lib/agent/tools/types';
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

/**
 * 応答の NDJSON をイベントの列にする（通常チャットも `text_delta` と `done` を送る。#31）。
 *
 * @param res - `/api/chat` の応答
 * @returns 受け取ったイベント（受信順）
 */
async function eventsOf(res: Response): Promise<AgentStreamEvent[]> {
  return (await res.text())
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as AgentStreamEvent);
}

/**
 * イベントの列から本文をつなげる。
 *
 * @param events - イベントの列
 * @returns `text_delta` の中身をつなげた本文
 */
function textOf(events: AgentStreamEvent[]): string {
  return events
    .map((event) => (event.type === 'text_delta' ? event.content : ''))
    .join('');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('POST /api/chat（通常チャット）', () => {
  describe('正常系', () => {
    it('Ollama のストリーミング応答を、本文の text_delta と終わりの done の NDJSON で中継する', async () => {
      stubFetch(() => ollamaStreamResponse(['こん', 'にちは']));

      const res = await POST(
        jsonRequest(URL, 'POST', { message: 'やあ', enableTools: false })
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/x-ndjson');
      const events = await eventsOf(res);
      expect(textOf(events)).toBe('こんにちは');
      expect(events.at(-1)?.type).toBe('done');
    });

    it('Ollama の終わりのチャンクのトークン数・所要時間を、done の metrics に載せる（#31）', async () => {
      stubFetch(() =>
        ollamaStreamResponse(['こんにちは'], {
          prompt_eval_count: 44,
          prompt_eval_cached_count: 43,
          prompt_eval_duration: 4_500_000,
          eval_count: 10,
          eval_duration: 250_000_000,
          load_duration: 2_000_000,
          total_duration: 260_000_000,
        })
      );

      const res = await POST(
        jsonRequest(URL, 'POST', { message: 'やあ', enableTools: false })
      );
      expect((await eventsOf(res)).at(-1)).toEqual({
        type: 'done',
        metadata: {
          metrics: {
            model: 'test',
            calls: 1,
            promptTokens: 44,
            promptCachedTokens: 43,
            maxPromptTokens: 44,
            promptDurationMs: 4.5,
            outputTokens: 10,
            outputDurationMs: 250,
            loadDurationMs: 2,
            totalDurationMs: 260,
          },
        },
      });
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

    it('先頭の system メッセージに、現在の日時と「検索できない」ことを入れる（#154）', async () => {
      // Date だけを偽る（タイマーまで偽るとストリームの読み取りが進まない）。
      // UTC 03:00 は UTC-3〜UTC+14 のどこでも 1 月 15 日のため、実行環境のタイムゾーンに左右されない
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2025-01-15T03:00:00Z'));
      const fetchMock = stubFetch(() => ollamaStreamResponse(['ok']));

      await POST(
        jsonRequest(URL, 'POST', {
          message: '今日は何日？',
          enableTools: false,
        })
      );

      const [, init] = fetchMock.mock.calls[0];
      const [system] = JSON.parse(init!.body as string).messages;
      expect(system.role).toBe('system');
      expect(system.content).toMatch(/^## 現在の日時\n2025年1月15日/);
      expect(system.content).toContain('この会話では Web 検索ができない');
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
        { role: 'system', content: expect.stringMatching(/^## 現在の日時\n/) },
        { role: 'user', content: '前の発言' },
        { role: 'user', content: '次は？' },
      ]);
    });

    it('systemPrompt（会話の役割）を先頭の system メッセージとして Ollama へ渡し、後ろに現在の日時を足す（#10・#154）', async () => {
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
        {
          role: 'system',
          content: expect.stringMatching(
            /^あなたは翻訳者です。\n\n## 現在の日時\n/
          ),
        },
        { role: 'user', content: '前の発言' },
        { role: 'user', content: 'Hello' },
      ]);
    });

    it('systemPrompt が空白のみなら、現在の日時だけを system メッセージにする', async () => {
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
        { role: 'system', content: expect.stringMatching(/^## 現在の日時\n/) },
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
      // 先頭（[0]）は現在の日時の system メッセージ
      expect(JSON.parse(init!.body as string).messages[1]).toEqual({
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
      expect(textOf(await eventsOf(res))).toBe('こんにちは');
    });

    it('Ollama が終わりのチャンクにトークン数を返さなければ、done は metrics を持たない（#31）', async () => {
      stubFetch(() => ollamaStreamResponse(['こんにちは']));

      const res = await POST(
        jsonRequest(URL, 'POST', { message: 'やあ', enableTools: false })
      );
      expect((await eventsOf(res)).at(-1)).toEqual({ type: 'done' });
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
