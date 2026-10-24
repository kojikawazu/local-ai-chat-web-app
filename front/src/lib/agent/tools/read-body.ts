/**
 * レスポンス本文が受信バイト数の上限を超えたことを表すエラー。
 *
 * 呼び出し側（`url_fetch` / `web_search`）が「サイズ超過」と「通信失敗・中断」を
 * 区別してユーザー向けメッセージを出し分けるために使う。
 */
export class BodyTooLargeError extends Error {
  /**
   * @param maxBytes - 超過した上限（バイト）
   */
  constructor(readonly maxBytes: number) {
    super(`レスポンス本文が上限 (${maxBytes} バイト) を超えました`);
    this.name = 'BodyTooLargeError';
  }
}

/**
 * エラーが `AbortSignal.timeout()` の期限切れによるものかを判定する。
 *
 * 期限切れの signal で中断された fetch / 本文読み取りは、signal の reason
 * （`name` が `'TimeoutError'` の `DOMException`）で reject される。
 *
 * @param e - 判定するエラー
 * @returns 期限切れによる中断なら `true`
 */
export function isTimeoutError(e: unknown): boolean {
  return e instanceof Error && e.name === 'TimeoutError';
}

/**
 * レスポンス本文を受信バイト数の上限付きでストリーム読み取りし、UTF-8 文字列で返す。
 *
 * `res.text()` と違い本文全体をバッファしてから検査するのではなく、受信のたびに
 * 累計バイト数を確かめ、上限を超えた時点で読み取りを打ち切る。`Content-Length` を
 * 持たない chunked 応答や、宣言より大きい本文にも効く。`signal` が中断されると
 * 本文が届かず止まっている最中でも即座に抜ける。いずれの失敗でも reader を
 * cancel し、残りの受信と接続を解放する。
 *
 * @param res - 読み取る fetch のレスポンス。本文が無い場合は空文字を返す
 * @param maxBytes - 受信を許す最大バイト数（文字数ではなく UTF-8 のバイト数）
 * @param signal - 読み取りを中断する signal（タイムアウトや呼び出し元の打ち切り）
 * @returns 本文を UTF-8 でデコードした文字列
 * @throws {BodyTooLargeError} 受信バイト数が `maxBytes` を超えた場合
 * @throws {Error} `signal` が中断された場合はその reason をそのまま投げる（期限切れなら `name` が `TimeoutError`）
 */
export async function readBodyWithLimit(
  res: Response,
  maxBytes: number,
  signal: AbortSignal
): Promise<string> {
  if (!res.body) return '';

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  // 本文が途中で止まると reader.read() は永久に解決しないため、
  // 中断を別の Promise にして race させ、待機から抜けられるようにする
  let removeAbortListener = () => {};
  const aborted = new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener('abort', onAbort);
  });
  // race に渡す前に中断済みと判明して throw する経路では aborted に誰も
  // ハンドラを付けないため、unhandled rejection にならないよう握りつぶしておく
  aborted.catch(() => {});

  try {
    while (true) {
      // 受信済みチャンクがあると race は read() 側を選ぶため、中断は毎回先に確かめる
      signal.throwIfAborted();
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) throw new BodyTooLargeError(maxBytes);
      chunks.push(value);
    }
  } catch (e) {
    // 超過・中断・読み取り失敗のいずれでも残りの受信を止める（cancel 自体の失敗は無視）
    reader.cancel().catch(() => {});
    throw e;
  } finally {
    removeAbortListener();
  }

  // チャンク境界でマルチバイト文字が分断されても壊れないよう、連結してから 1 回でデコードする
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * 読まずに捨てるレスポンス本文を cancel し、接続を解放する。
 *
 * ステータスや Content-Type で早期 return する際、本文を放置すると受信が続くため呼ぶ。
 *
 * @param res - 本文を破棄するレスポンス
 */
export function discardBody(res: Response): void {
  res.body?.cancel().catch(() => {});
}
