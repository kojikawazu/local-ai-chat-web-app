import { describe, it, expect } from 'vitest';
import {
  approvalCountdown,
  approvalExpiresAt,
  formatRemaining,
} from '@/lib/chat/approval-countdown';
import { APPROVAL_TIMEOUT_MS } from '@/constants/agent/approval';

/**
 * 承認カードの残り時間（#202。`docs/15-tool-approval.md`「承認の待ち時間」）の純ロジックの UT。
 *
 * 受け取った待ち時間から期限を出すこと・残りの秒数と表示の段階・`分:秒` の形を確かめる。
 * 1 秒ごとの数え直しとカードの表示は E2E が担う。
 */

/** イベントを受け取った時刻（任意の固定値） */
const RECEIVED_AT = 1_700_000_000_000;

describe('正常系', () => {
  it('受け取った時刻に待ち時間の上限を足して期限にする', () => {
    expect(approvalExpiresAt(APPROVAL_TIMEOUT_MS, RECEIVED_AT)).toBe(
      RECEIVED_AT + 5 * 60 * 1000
    );
  });

  it('受け取った直後は「残り 5:00」で、通常の色', () => {
    const expiresAt = RECEIVED_AT + APPROVAL_TIMEOUT_MS;
    expect(approvalCountdown(expiresAt, RECEIVED_AT)).toEqual({
      seconds: 300,
      level: 'normal',
      label: '残り 5:00',
    });
  });

  it('残りの秒数を「分:秒」にする（秒は 2 桁）', () => {
    expect(formatRemaining(272)).toBe('4:32');
    expect(formatRemaining(65)).toBe('1:05');
    expect(formatRemaining(9)).toBe('0:09');
  });
});

describe('準正常系', () => {
  const expiresAt = RECEIVED_AT + APPROVAL_TIMEOUT_MS;

  it('残り 1 分を切ったら警告の色にする（1:00 ちょうどから）', () => {
    expect(approvalCountdown(expiresAt, expiresAt - 61_000).level).toBe(
      'normal'
    );
    expect(approvalCountdown(expiresAt, expiresAt - 60_000)).toEqual({
      seconds: 60,
      level: 'warning',
      label: '残り 1:00',
    });
  });

  it('秒は切り上げ、1 秒に満たなくても残っている間は時間切れにしない', () => {
    expect(approvalCountdown(expiresAt, expiresAt - 200)).toEqual({
      seconds: 1,
      level: 'warning',
      label: '残り 0:01',
    });
  });

  it('期限になったら「時間切れ」にする', () => {
    expect(approvalCountdown(expiresAt, expiresAt)).toEqual({
      seconds: 0,
      level: 'expired',
      label: '時間切れ',
    });
  });

  it('期限を過ぎても、残りは 0 のまま（負にしない）', () => {
    expect(approvalCountdown(expiresAt, expiresAt + 90_000)).toEqual({
      seconds: 0,
      level: 'expired',
      label: '時間切れ',
    });
  });
});

describe('異常系', () => {
  it.each([
    ['届かない', undefined],
    ['数でない', '300000'],
    ['0', 0],
    ['負', -1],
    ['無限大', Number.POSITIVE_INFINITY],
    ['NaN', Number.NaN],
  ])('待ち時間が%sときは期限を持たない（残り時間を出さない）', (_, value) => {
    expect(approvalExpiresAt(value, RECEIVED_AT)).toBeUndefined();
  });
});
