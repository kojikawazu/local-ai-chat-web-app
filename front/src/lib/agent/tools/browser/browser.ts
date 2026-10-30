import type { Browser } from 'playwright-core';
import { chromium } from 'playwright-core';

/**
 * ブラウザのツールが使う Chromium を 1 つだけ起動し、プロセスの中で使い回す（#149。`docs/18-browser-tools.md`）。
 *
 * 応答ごとのセッション（コンテキスト）は {@link acquireBrowser} で借り、{@link releaseBrowser} で返す。
 * 借り手がいなくなってから {@link IDLE_CLOSE_MS} 使われなければ閉じる。
 */

/** 同時に開くセッションの上限。開発機のメモリ（64GB で大きいモデル・Docker と同時に動く）に合わせる */
export const MAX_BROWSER_SESSIONS = 2;

/** 借り手がいなくなってから Chromium を閉じるまでの時間（ミリ秒。5 分）。続けて頼むときに起動を待たせない */
const IDLE_CLOSE_MS = 5 * 60 * 1000;

/** Chromium が入っていないときに playwright-core が投げるエラーの文言の一部 */
const MISSING_EXECUTABLE_MESSAGE = "Executable doesn't exist";

/** プロセスの中で共有する状態 */
type BrowserState = {
  /** 起動中・起動済みの Chromium。閉じたら `undefined` */
  browser: Promise<Browser> | undefined;
  /** 貸し出し中のセッションの数 */
  sessions: number;
  /** 放置で閉じるタイマー */
  idleTimer: ReturnType<typeof setTimeout> | undefined;
};

// `globalThis` の型にブラウザの状態は無いため、二段キャストで足す。
// なぜ安全か: 参照するのは自前で足す `agentBrowser` プロパティ 1 つだけで、既存のグローバル型を書き換えない。
// なぜ必要か: route ごとにモジュールが別に読み込まれても、同じプロセスの中で Chromium を 1 つにするため（approvals.ts と同じ）
const globalForBrowser = globalThis as unknown as {
  agentBrowser: BrowserState | undefined;
};
const state: BrowserState =
  globalForBrowser.agentBrowser ??
  (globalForBrowser.agentBrowser = {
    browser: undefined,
    sessions: 0,
    idleTimer: undefined,
  });

/** {@link acquireBrowser} の結果。 */
export type AcquireResult =
  | { ok: true; browser: Browser }
  | {
      ok: false;
      /** 借りられない理由 */
      reason: string;
      /** 入力に関係なく使えない（Chromium が無い・起動できない）なら true */
      unavailable: boolean;
    };

/**
 * Chromium を起動する（起動済みなら使い回す）。閉じられたら次に借りるときに起動し直す。
 *
 * @returns 起動した Chromium
 */
function launch(): Promise<Browser> {
  if (state.browser) return state.browser;
  const launching = chromium.launch({ headless: true }).then((browser) => {
    browser.on('disconnected', () => {
      if (state.browser === launching) state.browser = undefined;
    });
    return browser;
  });
  state.browser = launching;
  // 起動に失敗したら、次の呼び出しで起動し直せるようにする
  launching.catch(() => {
    if (state.browser === launching) state.browser = undefined;
  });
  return launching;
}

/**
 * セッションを開くために Chromium を借りる。使い終わったら必ず {@link releaseBrowser} を呼ぶ。
 *
 * @returns 借りた Chromium、または借りられない理由（同時のセッションの上限・Chromium が無い）
 */
export async function acquireBrowser(): Promise<AcquireResult> {
  if (state.sessions >= MAX_BROWSER_SESSIONS) {
    return {
      ok: false,
      reason: `同時に開けるブラウザのセッション（${MAX_BROWSER_SESSIONS}）を使い切っています。ほかの応答が終わってから試してください`,
      unavailable: false,
    };
  }
  state.sessions++;
  clearTimeout(state.idleTimer);
  state.idleTimer = undefined;
  try {
    return { ok: true, browser: await launch() };
  } catch (e) {
    releaseBrowser();
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      reason: message.includes(MISSING_EXECUTABLE_MESSAGE)
        ? 'ブラウザ（Chromium）が入っていません。front で `pnpm exec playwright install chromium` を実行してください'
        : `ブラウザを起動できません: ${message.split('\n')[0]}`,
      unavailable: true,
    };
  }
}

/**
 * 借りた Chromium を返す。借り手がいなくなったら、放置で閉じるタイマーを掛ける。
 */
export function releaseBrowser(): void {
  state.sessions = Math.max(0, state.sessions - 1);
  if (state.sessions > 0) return;
  clearTimeout(state.idleTimer);
  state.idleTimer = setTimeout(() => {
    state.idleTimer = undefined;
    if (state.sessions > 0) return;
    const closing = state.browser;
    state.browser = undefined;
    void closing?.then((browser) => browser.close()).catch(() => {});
  }, IDLE_CLOSE_MS);
  // 放置のタイマーだけでプロセスを生かし続けない（テスト・終了時）
  state.idleTimer.unref?.();
}

/**
 * 貸し出し中のセッションの数を返す（テストで、応答の後に返されたことを確かめる）。
 *
 * @returns 貸し出し中の数
 */
export function activeBrowserSessions(): number {
  return state.sessions;
}

/**
 * Chromium をすぐに閉じる（テストの後片付け）。貸し出し中のセッションがあっても閉じる。
 *
 * @returns 閉じ終わったら解決する Promise
 */
export async function closeBrowser(): Promise<void> {
  clearTimeout(state.idleTimer);
  state.idleTimer = undefined;
  const closing = state.browser;
  state.browser = undefined;
  await closing?.then((browser) => browser.close()).catch(() => {});
}
