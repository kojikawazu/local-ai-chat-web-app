import { describe, it, expect, afterEach, vi } from 'vitest';
import { POST } from '@/app/api/chat/route';
import type { AgentStreamEvent } from '@/lib/tools/types';
import { jsonRequest } from './helpers/db';
import { stubFetch } from './helpers/ollama-stub';

/**
 * `/api/chat` の生成停止（#8）の IT。
 *
 * ブラウザの停止・切断は、応答ストリームの cancel と `request.signal` の abort の 2 通りで
 * route に届く。どちらでも Ollama への接続を切り（生成を止め）、エージェントでは実行中の
 * ツールを中断して次のラウンドへ進まないことを検証する。Ollama と取得先 Web は真の外部の
 * ため fetch をスタブし、「中断されるまで続きを返さない」応答で停止の瞬間を作る。
 * この経路は DB を使わない。
 */
const URL = 'http://localhost/api/chat';

// エージェントのツールの取得先。文書用アドレス（TEST-NET-3）の IP リテラルは DNS 解決も
// SSRF ブロックリストも通らないため、スタブだけで完結する（chat-agent.test.ts と同じ）
const TARGET_URL = 'http://203.0.113.10/page';

const encoder = new TextEncoder();

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** 中断の信号の abort を、実際の fetch と同じ `AbortError` にして返す */
function abortError(): DOMException {
  return new DOMException('This operation was aborted', 'AbortError');
}

/** Ollama のストリーミング応答の 1 行（本文の断片） */
function chunkLine(content: string): string {
  return (
    JSON.stringify({
      model: 'test',
      message: { role: 'assistant', content },
      done: false,
    }) + '\n'
  );
}

/**
 * 最初の断片を返したあと、中断されるまで続きを返さない Ollama 応答を作る。
 * 実際の fetch と同じく、`signal` が abort されたら本文の読み取りを AbortError にする。
 *
 * @param first - 最初に返す本文の断片
 * @param signal - route が Ollama への fetch に渡した中断の信号
 * @returns 応答と、本文が cancel されたかを記録する状態
 */
function hangingOllamaResponse(first: string, signal?: AbortSignal | null) {
  const upstream = { cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(chunkLine(first)));
      signal?.addEventListener('abort', () => controller.error(abortError()));
    },
    cancel() {
      upstream.cancelled = true;
    },
  });
  const response = new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' },
  });
  return { response, upstream };
}

/**
 * 中断されるまで解決しない fetch の結果（モデルの読み込み待ち・応答の遅い取得先の再現）。
 *
 * @param signal - fetch に渡された中断の信号
 * @returns abort で AbortError になる Promise
 */
function pendingUntilAborted(signal?: AbortSignal | null): Promise<Response> {
  return new Promise((_, reject) => {
    signal?.addEventListener('abort', () => reject(abortError()));
  });
}

/**
 * エージェントの NDJSON を、指定した種類のイベントが届くまで読む。
 *
 * @param reader - 応答本文のリーダー
 * @param type - 待つイベントの種類
 * @returns それまでに届いたイベント（指定の種類を含む）
 */
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  type: AgentStreamEvent['type']
): Promise<AgentStreamEvent[]> {
  const decoder = new TextDecoder();
  const events: AgentStreamEvent[] = [];
  let buffer = '';
  while (!events.some((e) => e.type === type)) {
    const { done, value } = await reader.read();
    if (done) throw new Error(`${type} が届く前にストリームが閉じた`);
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim()) events.push(JSON.parse(line));
    }
  }
  return events;
}

/** 中断後に走り得る後続処理（次のラウンドの問い合わせ等）が起きるだけの時間を待つ */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

describe('POST /api/chat の生成停止（通常チャット）', () => {
  describe('正常系', () => {
    it('応答ストリームを cancel すると、Ollama の応答の読み取りを止める', async () => {
      let upstream = { cancelled: false };
      stubFetch((_url, init) => {
        const hanging = hangingOllamaResponse('途中まで', init?.signal);
        upstream = hanging.upstream;
        return hanging.response;
      });

      const res = await POST(
        jsonRequest(URL, 'POST', {
          message: '長文を書いて',
          enableTools: false,
        })
      );
      const reader = res.body!.getReader();
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toBe('途中まで');

      await reader.cancel();

      expect(upstream.cancelled).toBe(true);
    });

    it('request.signal を Ollama への fetch に渡し、切断で abort してストリームを閉じる', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const fetchMock = stubFetch(
        (_url, init) => hangingOllamaResponse('途中まで', init?.signal).response
      );
      const browser = new AbortController();

      const res = await POST(
        jsonRequest(
          URL,
          'POST',
          { message: '長文を書いて', enableTools: false },
          browser.signal
        )
      );
      const reader = res.body!.getReader();
      await reader.read();
      browser.abort();

      const [, init] = fetchMock.mock.calls[0];
      expect(init!.signal!.aborted).toBe(true);
      // エラーにせず閉じる（停止は失敗ではない）
      expect((await reader.read()).done).toBe(true);
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('準正常系', () => {
    it('Ollama の応答前（モデルの読み込み待ち）に停止されたら 499 を返し、エラーログを出さない', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      let fetchCalled!: () => void;
      const called = new Promise<void>((resolve) => (fetchCalled = resolve));
      stubFetch((_url, init) => {
        fetchCalled();
        return pendingUntilAborted(init?.signal);
      });
      const browser = new AbortController();

      const pending = POST(
        jsonRequest(
          URL,
          'POST',
          { message: '長文を書いて', enableTools: false },
          browser.signal
        )
      );
      await called;
      browser.abort();
      const res = await pending;

      expect(res.status).toBe(499);
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('異常系', () => {
    it('停止ではない読み取りの失敗は、従来どおりストリームのエラーにしてログを残す', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      stubFetch(() => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(chunkLine('途中まで')));
            controller.error(new Error('connection reset'));
          },
        });
        return new Response(body, { status: 200 });
      });

      const res = await POST(
        jsonRequest(URL, 'POST', {
          message: '長文を書いて',
          enableTools: false,
        })
      );

      await expect(res.text()).rejects.toThrow();
      expect(errorSpy).toHaveBeenCalledWith(
        'Streaming error:',
        expect.any(Error)
      );
    });
  });
});

describe('POST /api/chat の生成停止（エージェント）', () => {
  /**
   * 1 回目の問い合わせで url_fetch を要求し、取得先は中断されるまで応答しない状態を作る。
   *
   * @returns Ollama への問い合わせ回数と、取得先へ渡された中断の信号を読む関数
   */
  function stubToolCallThenHangingTarget() {
    const state = {
      ollamaCalls: 0,
      targetSignal: undefined as AbortSignal | undefined,
    };
    let targetCalled!: () => void;
    const targetStarted = new Promise<void>(
      (resolve) => (targetCalled = resolve)
    );
    stubFetch((url, init) => {
      if (url === TARGET_URL) {
        state.targetSignal = init?.signal ?? undefined;
        targetCalled();
        return pendingUntilAborted(init?.signal);
      }
      state.ollamaCalls++;
      const line = JSON.stringify({
        model: 'test',
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            { function: { name: 'url_fetch', arguments: { url: TARGET_URL } } },
          ],
        },
        done: true,
      });
      return new Response(line + '\n', { status: 200 });
    });
    return { state, targetStarted };
  }

  describe('正常系', () => {
    it('ツール実行中に cancel すると、ツールの取得を中断し、次のラウンドの問い合わせをしない', async () => {
      const { state, targetStarted } = stubToolCallThenHangingTarget();

      const res = await POST(
        jsonRequest(URL, 'POST', { message: '調べて', enableTools: true })
      );
      const reader = res.body!.getReader();
      await readUntil(reader, 'tool_call_start');
      await targetStarted;

      await reader.cancel();
      await settle();

      expect(state.targetSignal!.aborted).toBe(true);
      expect(state.ollamaCalls).toBe(1);
    });
  });

  describe('準正常系', () => {
    it('本文の中継中に cancel すると、Ollama への fetch を abort する', async () => {
      // エージェントは <think> タグの分割に備えて本文の末尾 8 文字を保留してから流すため、
      // それより長い断片にして、停止前に text_delta が届くようにする
      const fetchMock = stubFetch(
        (_url, init) =>
          hangingOllamaResponse('途中まで書いた本文の断片です', init?.signal)
            .response
      );

      const res = await POST(
        jsonRequest(URL, 'POST', { message: '長文を書いて', enableTools: true })
      );
      const reader = res.body!.getReader();
      await readUntil(reader, 'text_delta');

      await reader.cancel();
      await settle();

      const [, init] = fetchMock.mock.calls[0];
      expect(init!.signal!.aborted).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('異常系', () => {
    it('request.signal の abort でもループを止め、error を送らずにストリームを閉じる', async () => {
      const { state, targetStarted } = stubToolCallThenHangingTarget();
      const browser = new AbortController();

      const res = await POST(
        jsonRequest(
          URL,
          'POST',
          { message: '調べて', enableTools: true },
          browser.signal
        )
      );
      const reader = res.body!.getReader();
      await readUntil(reader, 'tool_call_start');
      await targetStarted;

      browser.abort();

      // 中断後はイベントを送らずに閉じる（error を受けたクライアントは応答を破棄するため）
      expect((await reader.read()).done).toBe(true);
      await settle();
      expect(state.targetSignal!.aborted).toBe(true);
      expect(state.ollamaCalls).toBe(1);
    });
  });
});
