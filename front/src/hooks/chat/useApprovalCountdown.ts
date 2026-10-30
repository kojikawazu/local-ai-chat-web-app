import { useEffect, useState } from 'react';
import type { ApprovalCountdown } from '@/lib/chat/approval-countdown';
import { approvalCountdown } from '@/lib/chat/approval-countdown';

/** 残り時間を数え直す間隔（ミリ秒）。表示は秒単位のため 1 秒 */
const TICK_MS = 1000;

/**
 * 承認カードの残り時間を 1 秒ごとに数え直す（#202。`docs/15-tool-approval.md`「承認の待ち時間」）。
 *
 * 時間切れになったら数え直しをやめる。期限が無い（待ち時間が届かなかった）ときは数えない。
 *
 * @param expiresAt - 承認の期限（`Date.now()` と同じ基準のミリ秒）。無ければ `undefined`
 * @returns 残り時間。期限が無ければ `undefined`
 */
export function useApprovalCountdown(
  expiresAt: number | undefined
): ApprovalCountdown | undefined {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (expiresAt === undefined) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= expiresAt) clearInterval(timer);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [expiresAt]);

  return expiresAt === undefined
    ? undefined
    : approvalCountdown(expiresAt, now);
}
