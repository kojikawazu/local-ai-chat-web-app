// 符号なしの 10 進整数だけを受け付ける。parseInt は "10abc" を 10、"1.5" を 1 と
// 解釈して通してしまうため、文字列全体を検査する
const UNSIGNED_INTEGER_PATTERN = /^\d+$/;

/**
 * 環境変数の文字列を、1 以上 `max` 以下の整数として解釈する。
 *
 * 未設定・空文字は既定値を使う（警告しない）。数値として解釈できない値・0・負数・小数・
 * `max` 超過は既定値に戻し、設定ミスに気づけるよう `console.warn` で知らせる。
 * エージェントの安全弁（最大ラウンド数・タイムアウト）が誤設定で無効化されないようにするため。
 *
 * @param name - 環境変数名（警告メッセージに使う）
 * @param raw - 環境変数の値。未設定なら `undefined`
 * @param options - `fallback` は未設定・不正時に使う既定値、`max` は許容する最大値
 * @returns 解釈した整数。未設定・不正・範囲外なら `fallback`
 */
export function parsePositiveIntEnv(
  name: string,
  raw: string | undefined,
  options: { fallback: number; max: number }
): number {
  const { fallback, max } = options;
  const trimmed = raw?.trim() ?? '';
  if (trimmed === '') return fallback;

  const value = UNSIGNED_INTEGER_PATTERN.test(trimmed)
    ? Number(trimmed)
    : Number.NaN;
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    console.warn(
      `環境変数 ${name} の値 "${trimmed}" は 1〜${max} の整数ではないため、既定値 ${fallback} を使います`
    );
    return fallback;
  }
  return value;
}
