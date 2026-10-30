/**
 * 承認カードの残り時間（#202。`docs/15-tool-approval.md`「承認の待ち時間」）。
 *
 * サーバーは `tool_approval_request` に待ち時間の上限（ミリ秒）を載せる。画面は受け取った時刻に足して期限にし、
 * 1 秒ごとに残りを出す。時間切れの決着はサーバーが持つため、ここは目安の表示だけを決める。
 */

/** 残りがこの秒数以下になったら、警告の色にする（1 分） */
const WARNING_SECONDS = 60;

/** 残り時間の表示の段階。`expired` になったら許可・拒否のボタンを押せなくする */
export type CountdownLevel = 'normal' | 'warning' | 'expired';

/** 承認カードに出す残り時間。 */
export type ApprovalCountdown = {
  /** 残りの秒数（切り上げ。0 以上） */
  seconds: number;
  /** 表示の段階 */
  level: CountdownLevel;
  /** 表示する文字列（`残り 4:32`・`時間切れ`） */
  label: string;
};

/**
 * 受け取った待ち時間の上限から、画面の時計での期限を出す。
 *
 * 待ち時間は外から届く値のため、正の有限の数でなければ期限を持たない（残り時間を出さない）。
 *
 * @param timeoutMs - `tool_approval_request` の待ち時間の上限（ミリ秒）
 * @param receivedAt - イベントを受け取った時刻（`Date.now()`）
 * @returns 期限（`Date.now()` と同じ基準のミリ秒）。待ち時間が不正なら `undefined`
 */
export function approvalExpiresAt(
  timeoutMs: unknown,
  receivedAt: number
): number | undefined {
  if (
    typeof timeoutMs !== 'number' ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  ) {
    return undefined;
  }
  return receivedAt + timeoutMs;
}

/**
 * 残りの秒数を `分:秒` にする。
 *
 * @param seconds - 残りの秒数（0 以上の整数）
 * @returns `4:32` の形の文字列
 */
export function formatRemaining(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * 期限と今の時刻から、承認カードに出す残り時間を決める。
 *
 * 秒は切り上げる（`4:59.2` は `5:00` ではなく、まだ 1 秒残っている間は 0 にしない）。
 *
 * @param expiresAt - 期限（{@link approvalExpiresAt}）
 * @param now - 今の時刻（`Date.now()`）
 * @returns 残りの秒数・表示の段階・表示する文字列
 */
export function approvalCountdown(
  expiresAt: number,
  now: number
): ApprovalCountdown {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  if (seconds === 0) return { seconds, level: 'expired', label: '時間切れ' };
  return {
    seconds,
    level: seconds <= WARNING_SECONDS ? 'warning' : 'normal',
    label: `残り ${formatRemaining(seconds)}`,
  };
}
