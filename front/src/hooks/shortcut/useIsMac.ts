'use client';

import { useSyncExternalStore } from 'react';
import { isMacPlatform } from '@/lib/shortcut/match';

/** `navigator.userAgentData`（Chromium のみ）の、使う部分の形。TypeScript の DOM の型にまだ無いため、ここで書く */
type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: { platform?: string };
};

/**
 * 開いている端末が Mac かを読む（変わらないので購読はしない）。
 *
 * @returns Mac なら true
 */
export function readIsMac(): boolean {
  // userAgentData は型に無いため、使う部分だけを足した形として読む（無ければ navigator.platform に戻る）
  const nav = navigator as NavigatorWithUserAgentData;
  return isMacPlatform(nav.userAgentData?.platform || nav.platform || '');
}

/**
 * 端末は開いている間に変わらないため、購読の口は何もしない。
 *
 * @returns 購読をやめる関数（何もしない）
 */
function subscribe(): () => void {
  return () => {};
}

/**
 * 開いている端末が Mac かを返す（#33。ショートカットの ⌘ と Ctrl の出し分けに使う）。
 *
 * サーバーでの描画（`navigator` が無い）では false にし、ブラウザで描き直したときに正しい値にする。
 *
 * @returns Mac なら true
 */
export function useIsMac(): boolean {
  return useSyncExternalStore(subscribe, readIsMac, () => false);
}
