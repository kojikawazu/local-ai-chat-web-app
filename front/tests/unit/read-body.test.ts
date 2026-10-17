import { describe, it, expect } from 'vitest';
import {
  BodyTooLargeError,
  isTimeoutError,
  readBodyWithLimit,
} from '@/lib/tools/read-body';

/**
 * `readBodyWithLimit` の UT。fetch を介さず `ReadableStream` から `Response` を直接組むため mock は使わない。
 * 契約: 受信バイト数が上限を超えた時点／signal が中断された時点で読み取りを打ち切り、
 * 本文全体をバッファせず reader を cancel する（#92）。
 */

const encoder = new TextEncoder();

/** 未中断の signal。中断を検証しないケースで使う */
const idleSignal = () => new AbortController().signal;

/**
 * 指定したバイト列を 1 チャンクずつ流して終わる本文を作る。
 *
 * @param chunks - 順に enqueue するチャンク
 * @returns チャンクを流す `Response`（Content-Length なし）
 */
function responseOf(chunks: Uint8Array[]): Response {
  let i = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i < chunks.length) controller.enqueue(chunks[i++]);
        else controller.close();
      },
    })
  );
}

/**
 * 終端せず固定サイズのチャンクを流し続ける本文と、その受信状況の観測値を作る。
 * 「Content-Length なしの巨大な chunked 応答」を模し、途中で読み取りが止まったかを
 * pull 回数と cancel の有無で確かめる。
 *
 * @param chunkBytes - 1 チャンクのバイト数
 * @returns 本文を流す `Response` と、pull 回数・cancel 有無を読む観測オブジェクト
 */
function endlessResponse(chunkBytes: number) {
  const observed = { pulls: 0, cancelled: false };
  const res = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        observed.pulls++;
        controller.enqueue(new Uint8Array(chunkBytes).fill(0x61));
      },
      cancel() {
        observed.cancelled = true;
      },
    })
  );
  return { res, observed };
}

/**
 * 最初のチャンクを流した後、終端も追加送信もせず止まる本文を作る。
 * 「ヘッダーだけ返して本文を終端しない slow response」を模す。
 *
 * @returns 本文を流す `Response` と、cancel 有無を読む観測オブジェクト
 */
function stalledResponse() {
  const observed = { cancelled: false };
  let sent = false;
  const res = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(encoder.encode('先頭だけ'));
          return;
        }
        // 解決しない Promise を返し、次のチャンクを永久に待たせる
        return new Promise<void>(() => {});
      },
      cancel() {
        observed.cancelled = true;
      },
    })
  );
  return { res, observed };
}

describe('readBodyWithLimit', () => {
  describe('正常系', () => {
    it('上限以下の本文を複数チャンクにわたって連結して返す', async () => {
      const res = responseOf([
        encoder.encode('Hello, '),
        encoder.encode('World'),
      ]);
      expect(await readBodyWithLimit(res, 1024, idleSignal())).toBe(
        'Hello, World'
      );
    });

    it('チャンク境界で分断された UTF-8 マルチバイト文字を正しく復元する', async () => {
      // 「あ」は UTF-8 で 3 バイト（E3 81 82）。1 バイト目と残りを別チャンクにする
      const bytes = encoder.encode('あい');
      const res = responseOf([
        bytes.slice(0, 1),
        bytes.slice(1, 4),
        bytes.slice(4),
      ]);
      expect(await readBodyWithLimit(res, 1024, idleSignal())).toBe('あい');
    });

    it('上限ちょうどのバイト数は受け入れる', async () => {
      const res = responseOf([encoder.encode('12345')]);
      expect(await readBodyWithLimit(res, 5, idleSignal())).toBe('12345');
    });
  });

  describe('準正常系', () => {
    it('Content-Length なしで上限を超える本文は途中で打ち切り、残りを受信しない', async () => {
      const chunkBytes = 64 * 1024;
      const maxBytes = 1024 * 1024;
      const { res, observed } = endlessResponse(chunkBytes);

      await expect(
        readBodyWithLimit(res, maxBytes, idleSignal())
      ).rejects.toBeInstanceOf(BodyTooLargeError);

      expect(observed.cancelled).toBe(true);
      // 上限を超えた最初のチャンクで止まる（read-ahead の 1 チャンク分を許容）。
      // 終端しない本文を最後まで読もうとすれば、このテスト自体が終わらない
      expect(observed.pulls).toBeLessThanOrEqual(maxBytes / chunkBytes + 2);
    });

    it('上限は文字数ではなく UTF-8 のバイト数で判定する', async () => {
      // 2 文字だが 6 バイト。文字数（2）で判定していれば上限 5 を超えない
      const res = responseOf([encoder.encode('あい')]);
      await expect(
        readBodyWithLimit(res, 5, idleSignal())
      ).rejects.toBeInstanceOf(BodyTooLargeError);
    });

    it('本文が無いレスポンスは空文字を返す', async () => {
      const res = new Response(null, { status: 204 });
      expect(await readBodyWithLimit(res, 1024, idleSignal())).toBe('');
    });
  });

  describe('異常系', () => {
    it('本文が途中で止まっても、期限切れの signal で中断して TimeoutError を投げる', async () => {
      const { res, observed } = stalledResponse();

      const error = await readBodyWithLimit(
        res,
        1024,
        AbortSignal.timeout(50)
      ).catch((e: unknown) => e);

      expect(isTimeoutError(error)).toBe(true);
      expect(observed.cancelled).toBe(true);
    });

    it('呼び出し元の abort では、その reason をそのまま投げて読み取りを止める', async () => {
      const { res, observed } = stalledResponse();
      const controller = new AbortController();
      const reason = new Error('ツールがタイムアウトしました');

      const pending = readBodyWithLimit(res, 1024, controller.signal);
      controller.abort(reason);

      await expect(pending).rejects.toBe(reason);
      expect(observed.cancelled).toBe(true);
    });

    it('開始前に中断済みの signal ではチャンクを読まずに失敗する', async () => {
      const { res, observed } = endlessResponse(16);
      const controller = new AbortController();
      controller.abort(new Error('中断済み'));

      await expect(
        readBodyWithLimit(res, 1024, controller.signal)
      ).rejects.toThrow('中断済み');
      expect(observed.cancelled).toBe(true);
    });
  });
});

describe('isTimeoutError', () => {
  describe('正常系', () => {
    it('AbortSignal.timeout の reason を期限切れと判定する', async () => {
      const signal = AbortSignal.timeout(1);
      await new Promise((r) => setTimeout(r, 20));
      expect(isTimeoutError(signal.reason)).toBe(true);
    });
  });

  describe('準正常系', () => {
    it('手動 abort の reason（AbortError）は期限切れと判定しない', () => {
      const controller = new AbortController();
      controller.abort();
      expect(isTimeoutError(controller.signal.reason)).toBe(false);
    });
  });

  describe('異常系', () => {
    it('Error 以外の値は期限切れと判定しない', () => {
      expect(isTimeoutError('TimeoutError')).toBe(false);
      expect(isTimeoutError(undefined)).toBe(false);
    });
  });
});
