import { describe, it, expect, afterEach, vi } from 'vitest';
import { POST } from '@/app/api/diagrams/plantuml/route';
import { jsonRequest } from './helpers/db';
import { stubFetch } from './helpers/ollama-stub';
import { MAX_DIAGRAM_SOURCE_LENGTH } from '@/lib/shared/validation';

/**
 * `POST /api/diagrams/plantuml` の IT（#171）。PlantUML サーバーの `POST /svg` を fetch スタブし、
 * SVG の中継・入力の誤り（400）・PlantUML が描けないとき（400）・サーバーに繋がらないとき（502）・
 * 切断（499）の契約を検証する。DB 非依存。
 */

const URL_ = 'http://localhost/api/diagrams/plantuml';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><text>Alice</text></svg>';

/**
 * PlantUML サーバーが描けなかったときの応答（400・理由と行番号のヘッダー・エラーを描いた SVG）を作る。
 *
 * @param error - `X-PlantUML-Diagram-Error` の値
 * @param line - `X-PlantUML-Diagram-Error-Line` の値（0 始まり）
 * @returns PlantUML サーバーの 400 応答
 */
function plantUmlError(error: string, line: string) {
  return new Response('<svg><text>error</text></svg>', {
    status: 400,
    headers: {
      'Content-Type': 'image/svg+xml',
      'X-PlantUML-Diagram-Error': error,
      'X-PlantUML-Diagram-Error-Line': line,
    },
  });
}

/**
 * 実際の fetch と同じく、`signal` が中断されるまで応答しない（中断されたら AbortError で失敗する）。
 *
 * @param signal - fetch に渡された中断の信号
 * @returns 中断で失敗する Promise
 */
function pendingUntilAborted(signal?: AbortSignal | null): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () =>
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    );
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('POST /api/diagrams/plantuml', () => {
  describe('正常系', () => {
    it('ソースを書かれたまま PlantUML サーバーの /svg に POST し、SVG を { svg } で返す', async () => {
      const fetchMock = stubFetch(
        () =>
          new Response(SVG, {
            status: 200,
            headers: { 'Content-Type': 'image/svg+xml' },
          })
      );
      const source = 'Alice -> Bob : こんにちは\n';

      const res = await POST(jsonRequest(URL_, 'POST', { source }));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ svg: SVG });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://localhost:8889/svg');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBe(source);
    });

    it('接続先は PLANTUML_URL で変えられる（末尾の / は落とす）', async () => {
      vi.stubEnv('PLANTUML_URL', 'http://plantuml.test:9000/');
      const fetchMock = stubFetch(() => new Response(SVG, { status: 200 }));

      await POST(jsonRequest(URL_, 'POST', { source: 'A -> B' }));

      expect(fetchMock.mock.calls[0][0]).toBe('http://plantuml.test:9000/svg');
    });
  });

  describe('準正常系', () => {
    it('構文の誤りは 400 と、PlantUML の理由に 1 始まりの行番号を添えたメッセージを返す', async () => {
      stubFetch(() =>
        plantUmlError('Syntax Error? (Assumed diagram type: sequence)', '1')
      );

      const res = await POST(
        jsonRequest(URL_, 'POST', { source: 'A -> B\nfoo ]]' })
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'Syntax Error? (Assumed diagram type: sequence)（2 行目）',
      });
    });

    it('SANDBOX で止めた include も 400 で理由を返す', async () => {
      stubFetch(() => plantUmlError('Cannot open URL', '0'));

      const res = await POST(
        jsonRequest(URL_, 'POST', {
          source: '!include https://example.com/x.puml',
        })
      );

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('Cannot open URL（1 行目）');
    });

    it.each([
      ['空白だけ', { source: '  \n ' }, '図のソースが空です'],
      [
        '上限超え',
        { source: 'a'.repeat(MAX_DIAGRAM_SOURCE_LENGTH + 1) },
        '図のソースは50,000文字以内で指定してください',
      ],
    ])(
      'ソースが%sなら 400 を返し、PlantUML サーバーへ送らない',
      async (_label, body, error) => {
        const fetchMock = stubFetch(() => new Response(SVG));

        const res = await POST(jsonRequest(URL_, 'POST', body));

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error });
        expect(fetchMock).not.toHaveBeenCalled();
      }
    );
  });

  describe('異常系', () => {
    it.each([
      ['JSON の構文が不正', '{source:'],
      ['ボディが配列', ['A -> B']],
      ['source が数値', { source: 1 }],
    ])('%sなら 400 を返す', async (_label, body) => {
      const fetchMock = stubFetch(() => new Response(SVG));

      const res = await POST(jsonRequest(URL_, 'POST', body));

      expect(res.status).toBe(400);
      expect(typeof (await res.json()).error).toBe('string');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      [
        '接続できない',
        () => {
          throw new TypeError('fetch failed');
        },
      ],
      [
        '時間切れ',
        () => {
          throw new DOMException('The operation timed out.', 'TimeoutError');
        },
      ],
      ['500 を返す', () => new Response('error', { status: 500 })],
    ])(
      'PlantUML サーバーに%sと 502 と起動の案内を返す',
      async (_label, handler) => {
        stubFetch(handler);

        const res = await POST(jsonRequest(URL_, 'POST', { source: 'A -> B' }));

        expect(res.status).toBe(502);
        expect((await res.json()).error).toBe(
          'PlantUML サーバーに接続できませんでした。`docker compose up -d` で起動してください'
        );
      }
    );

    it('応答前にクライアントが切断したら、PlantUML への fetch を止めて本文なしの 499 を返す', async () => {
      let fetchSignal: AbortSignal | null | undefined;
      stubFetch((_url, init) => {
        fetchSignal = init?.signal;
        return pendingUntilAborted(init?.signal);
      });
      const controller = new AbortController();

      const pending = POST(
        jsonRequest(URL_, 'POST', { source: 'A -> B' }, controller.signal)
      );
      await vi.waitFor(() => expect(fetchSignal).toBeDefined());
      controller.abort();
      const res = await pending;

      expect(res.status).toBe(499);
      expect(await res.text()).toBe('');
      expect(fetchSignal?.aborted).toBe(true);
    });
  });
});
