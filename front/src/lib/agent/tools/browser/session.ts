import type { BrowserContext, Page } from 'playwright-core';
import type { ToolContext } from '../types';
import { acquireBrowser, releaseBrowser } from './browser';
import type { BrowserProxy } from './proxy';
import { startProxy } from './proxy';
import type { DestinationPolicy } from './url-policy';
import { appPortOf, isLocalOriginUrl, judgeDestination } from './url-policy';
import { BROWSER_VIEWPORT } from '@/constants/agent/browser';

/** 応答ごとの文脈（`scope`）にセッションを置くキー */
const SESSION_KEY = 'browser-session';

/** 1 回の応答の間だけ使うブラウザのセッション。 */
export type BrowserSession = {
  /** 宛先を判定するプロキシ（止めた接続の記録を持つ） */
  proxy: BrowserProxy;
  /**
   * ページを返す。まだ無い・中断で閉じたなら開き直す
   *
   * @returns ページ
   */
  page: () => Promise<Page>;
  /**
   * 開いているページを返す（開き直さない）
   *
   * @returns ページ。まだ何も開いていない・閉じたなら `undefined`
   */
  openedPage: () => Page | undefined;
  /**
   * URL が、許可した手元の開発サーバーのものかを返す
   *
   * @param url - ページの URL
   * @returns 手元の開発サーバーなら true
   */
  isLocalUrl: (url: string) => boolean;
};

/** {@link getSession} の結果。 */
export type SessionResult =
  | { ok: true; session: BrowserSession }
  | {
      ok: false;
      /** 開けない理由 */
      reason: string;
      /** 入力に関係なく使えない（Chromium が無い等）なら true */
      unavailable: boolean;
    };

/**
 * 応答ごとの文脈から、宛先の判定の決まりを作る（#149）。
 *
 * @param context - 応答ごとの文脈
 * @param localOrigins - 開いてよい手元の開発サーバー
 * @returns 判定の決まり（手元の情報を読んだ後は公開の Web へ接続しない）
 */
export function policyFor(
  context: ToolContext,
  localOrigins: readonly string[]
): DestinationPolicy {
  return {
    localOrigins,
    appPort: appPortOf(context.appOrigin),
    publicAllowed: () => !context.hasReadLocal(),
  };
}

/**
 * セッションを作る。Chromium を借り、プロキシを起動し、空のコンテキストを開く。後始末を応答の終わりに登録する。
 *
 * @param context - 応答ごとの文脈
 * @param localOrigins - 開いてよい手元の開発サーバー
 * @returns 作ったセッション、または開けない理由
 */
async function createSession(
  context: ToolContext,
  localOrigins: readonly string[]
): Promise<SessionResult> {
  const acquired = await acquireBrowser();
  if (!acquired.ok) return acquired;

  const policy = policyFor(context, localOrigins);
  let proxy: BrowserProxy | undefined;
  let browserContext: BrowserContext | undefined;
  try {
    proxy = await startProxy((hostname, port) =>
      judgeDestination(hostname, port, policy)
    );
    browserContext = await acquired.browser.newContext({
      // Chromium は既定でループバックへの通信をプロキシに通さないため、`<-loopback>` で外す（localhost も判定する）
      proxy: { server: proxy.server, bypass: '<-loopback>' },
      viewport: BROWSER_VIEWPORT,
      locale: 'ja-JP',
      acceptDownloads: false,
      serviceWorkers: 'block',
    });
  } catch (e) {
    await browserContext?.close().catch(() => {});
    await proxy?.close();
    releaseBrowser();
    return {
      ok: false,
      reason: `ブラウザを開けません: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`,
      unavailable: false,
    };
  }

  const openedContext = browserContext;
  const openedProxy = proxy;
  context.onDispose(async () => {
    await openedContext.close().catch(() => {});
    await openedProxy.close();
    releaseBrowser();
  });

  let current: Page | undefined;
  return {
    ok: true,
    session: {
      proxy: openedProxy,
      async page() {
        if (current && !current.isClosed()) return current;
        const page = await openedContext.newPage();
        // 新しいウィンドウは開かせず、ダイアログ（alert・confirm）は閉じる（読み取りだけのため。Phase C で見直す）
        page.on('popup', (popup) => void popup.close().catch(() => {}));
        page.on('dialog', (dialog) => void dialog.dismiss().catch(() => {}));
        current = page;
        return page;
      },
      openedPage: () =>
        current && !current.isClosed() && current.url() !== 'about:blank'
          ? current
          : undefined,
      isLocalUrl: (url) => isLocalOriginUrl(url, localOrigins),
    },
  };
}

/**
 * 応答ごとの文脈に置いたセッションを取り出す。
 *
 * @param context - 応答ごとの文脈
 * @returns 作成中・作成済みのセッション。まだ無ければ `undefined`
 */
function storedSession(
  context: ToolContext
): Promise<SessionResult> | undefined {
  const stored = context.scope.get(SESSION_KEY);
  // scope は型を持たない置き場（Map<string, unknown>）。SESSION_KEY に置くのはこのファイルの getSession だけで、
  // 置く値は常に Promise<SessionResult> のため、Promise であることを確かめてから型を付け直してよい
  return stored instanceof Promise
    ? (stored as Promise<SessionResult>)
    : undefined;
}

/**
 * この応答のブラウザのセッションを返す。無ければ作る（同じ応答の中で並んだ呼び出しも 1 つを共有する）。
 *
 * 作れなかったときは覚えず、次の呼び出しで作り直す（同時のセッションの上限は、ほかの応答が終われば空く）。
 *
 * @param context - 応答ごとの文脈
 * @param localOrigins - 開いてよい手元の開発サーバー
 * @returns セッション、または開けない理由
 */
export function getSession(
  context: ToolContext,
  localOrigins: readonly string[]
): Promise<SessionResult> {
  const existing = storedSession(context);
  if (existing) return existing;
  const created = createSession(context, localOrigins).then((result) => {
    if (!result.ok) context.scope.delete(SESSION_KEY);
    return result;
  });
  context.scope.set(SESSION_KEY, created);
  return created;
}

/**
 * この応答で開いたページを返す（セッションを作らない）。読み直し・スクリーンショットに使う。
 *
 * @param context - 応答ごとの文脈
 * @returns 開いたページとセッション。まだ何も開いていなければ `undefined`
 */
export async function getOpenedPage(
  context: ToolContext
): Promise<{ page: Page; session: BrowserSession } | undefined> {
  const existing = storedSession(context);
  if (!existing) return undefined;
  const result = await existing;
  if (!result.ok) return undefined;
  const page = result.session.openedPage();
  return page ? { page, session: result.session } : undefined;
}
