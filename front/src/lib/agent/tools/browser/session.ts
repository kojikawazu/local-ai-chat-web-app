import type { BrowserContext, Frame, Page } from 'playwright-core';
import type { ToolContext } from '../types';
import { acquireBrowser, releaseBrowser } from './browser';
import type { BrowserProxy } from './proxy';
import { startProxy } from './proxy';
import type { DestinationPolicy } from './url-policy';
import {
  appPortOf,
  gateByTopPage,
  isLocalOriginUrl,
  judgeDestination,
} from './url-policy';
import {
  BROWSER_SETTLE_TIMEOUT_MS,
  BROWSER_VIEWPORT,
} from '@/constants/agent/browser';

/** 応答ごとの文脈（`scope`）にセッションを置くキー */
const SESSION_KEY = 'browser-session';

/** 通信が落ち着いたとみなす、進行中のリクエストが無い時間（ミリ秒）。Playwright の `networkidle` と同じ長さ */
const QUIET_MS = 500;

/** 通信が落ち着いたかを確かめる間隔（ミリ秒） */
const QUIET_POLL_MS = 50;

/** 1 回の応答の間だけ使うブラウザのセッション。 */
export type BrowserSession = {
  /** 宛先を判定するプロキシ（止めた接続の記録を持つ） */
  proxy: BrowserProxy;
  /**
   * ページで起きたことの記録（閉じたダイアログ・開かずに閉じた新しいウィンドウ）。古い順に足していく。
   * 操作のツール（#149 Phase C）が、操作の間に増えた分を結果に書く
   */
  notices: string[];
  /**
   * 通信が落ち着くまで待つ（#149 Phase C）。進行中のリクエストが無い状態が {@link QUIET_MS} 続いたら返る。
   * 上限（{@link BROWSER_SETTLE_TIMEOUT_MS}）で待つのをやめる（ポーリングするページで時間を使い切らない）。
   * `waitForLoadState('networkidle')` は文書ごとに 1 度しか待たず、操作が後から始めたリクエスト（`fetch`・新しいウィンドウ）を待たないため、
   * コンテキストのリクエストを数えて待つ
   *
   * @returns 落ち着いた・上限に達したら解決する Promise
   */
  waitForQuiet: () => Promise<void>;
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
   * これから開くページを知らせる。最上位のページが手元の開発サーバーかを、開く前に切り替える
   * （開くページへのリクエスト自体が、最上位のページの判定で止まらないように）。
   * 公開のページから手元のページへ移るときは、先に空のページ（about:blank）へ移って古いページのスクリプトを止めてから切り替える
   * （切り替えた後に、古い公開のページのスクリプトが手元へ接続できる隙を作らない）
   *
   * @param page - 開くページ
   * @param url - 開く URL
   * @returns 切り替え終わったら解決する Promise
   */
  prepareNavigation: (page: Page, url: string) => Promise<void>;
  /**
   * 最上位のページの判定を、今のページの URL に合わせ直す（開けなかった・中断したとき）
   *
   * @param page - ページ
   */
  syncTopPage: (page: Page) => void;
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
  const isLocalUrl = (url: string) => isLocalOriginUrl(url, localOrigins);
  // 最上位のページが手元の開発サーバーか。公開のページから手元へ接続させないために、プロキシが読む（gateByTopPage）
  let topIsLocal = false;
  let proxy: BrowserProxy | undefined;
  let browserContext: BrowserContext | undefined;
  try {
    proxy = await startProxy(async (hostname, port) =>
      gateByTopPage(await judgeDestination(hostname, port, policy), topIsLocal)
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
  const notices: string[] = [];
  // 新しいウィンドウは、最初のページの読み込みのリクエストで記録する。popup のイベントは読み込みの応答の後まで来ず、
  // 操作の後に落ち着くのを待つ間に間に合わないため（docs/18-browser-tools.md「Phase C の前提の調査」）。転送で続くリクエストは記録しない
  const noticedPopups = new WeakSet<Page>();
  const noticePopup = (url: string) =>
    notices.push(
      `新しいウィンドウ（${url}）は開かずに閉じました。開くなら browser_navigate を使ってください`
    );
  // 進行中のリクエストの数と、最後に始まった・終わった時刻（waitForQuiet が読む）
  let inflight = 0;
  let lastActivity = 0;
  const settle = () => {
    inflight = Math.max(0, inflight - 1);
    lastActivity = Date.now();
  };
  openedContext.on('requestfinished', settle);
  openedContext.on('requestfailed', settle);
  openedContext.on('request', (request) => {
    inflight++;
    lastActivity = Date.now();
    if (!request.isNavigationRequest() || request.redirectedFrom()) return;
    let frame: Frame;
    try {
      frame = request.frame();
    } catch {
      // 新しいウィンドウの最初の読み込みは、フレームができる前に始まり、frame() が例外を投げる
      noticePopup(request.url());
      return;
    }
    // window.open() で空のウィンドウを開いてから移る場合は、フレームがある
    const page = frame.page();
    if (page === current || frame !== page.mainFrame()) return;
    if (noticedPopups.has(page)) return;
    noticedPopups.add(page);
    noticePopup(request.url());
  });
  return {
    ok: true,
    session: {
      proxy: openedProxy,
      notices,
      async waitForQuiet() {
        const since = Date.now();
        const deadline = since + BROWSER_SETTLE_TIMEOUT_MS;
        while (Date.now() < deadline) {
          if (
            inflight === 0 &&
            Date.now() - Math.max(lastActivity, since) >= QUIET_MS
          ) {
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, QUIET_POLL_MS));
        }
      },
      async page() {
        if (current && !current.isClosed()) return current;
        const page = await openedContext.newPage();
        // 新しいウィンドウは開かせず（記録は上のリクエストで）、ダイアログ（alert・confirm・prompt）は閉じる（confirm はキャンセルになる）。
        // ページは 1 つに保ち、確かめる操作を確かめずに進めない（docs/18-browser-tools.md「Phase C の決めること」）
        page.on('popup', (popup) => void popup.close().catch(() => {}));
        page.on('dialog', (dialog) => {
          notices.push(
            `ダイアログ（${dialog.type()}）「${dialog.message()}」を${dialog.type() === 'alert' ? '閉じました' : 'キャンセルしました'}`
          );
          void dialog.dismiss().catch(() => {});
        });
        // ページの中のスクリプトによる移動（location.href 等）・転送の後も、最上位のページを追う
        page.on('framenavigated', (frame) => {
          if (frame === page.mainFrame()) topIsLocal = isLocalUrl(frame.url());
        });
        current = page;
        return page;
      },
      openedPage: () =>
        current && !current.isClosed() && current.url() !== 'about:blank'
          ? current
          : undefined,
      async prepareNavigation(page, url) {
        const toLocal = isLocalUrl(url);
        if (toLocal && !topIsLocal && page.url() !== 'about:blank') {
          // 古い公開のページを捨てる。空のページへの移動はプロキシを通らない
          await page.goto('about:blank');
        }
        topIsLocal = toLocal;
      },
      syncTopPage(page) {
        topIsLocal = !page.isClosed() && isLocalUrl(page.url());
      },
      isLocalUrl,
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
