import type { Tool } from '../types';
import { toolError, toolUnavailable } from '../output';
import { getSession, policyFor } from './session';
import { formatPageResult, takeSnapshot } from './snapshot';
import {
  isLocalOriginUrl,
  judgeDestination,
  parseBrowserUrl,
} from './url-policy';
import {
  BROWSER_BLOCKED_HEADER,
  BROWSER_EXCLUSIVE,
  BROWSER_NO_CONTEXT_REASON,
  BROWSER_SETTLE_TIMEOUT_MS,
} from '@/constants/agent/browser';

/** ページを開くのを待つ時間（ミリ秒）。`url_fetch` と同じ。ツール全般の上限（既定 30 秒）の中に収める */
const NAVIGATION_TIMEOUT_MS = 15_000;

/**
 * ページを開き、アクセシビリティツリーで読むツールを作る（#149。`docs/18-browser-tools.md`）。
 *
 * 開く URL は、ブラウザに渡す前にも宛先を判定する（止めた理由をはっきり返すため。転送の先・ページの中のリクエストは
 * プロキシが判定する）。開いたら、ネットワークが落ち着くのを少し待ってからスナップショットを返す。
 * `access` は開く URL で決まる（手元の開発サーバーなら `local`、それ以外は `network`）。
 * 公開のページからは手元の開発サーバーへ接続させない（転送・ページの中のリクエストも。`gateByTopPage`）。
 * 開いた後のページが手元の開発サーバーなら、結果の `readLocal` で知らせる。
 *
 * @param localOrigins - 開いてよい手元の開発サーバー（`BROWSER_LOCAL_ORIGINS`）
 * @returns `browser_navigate` のツール
 */
export function createBrowserNavigateTool(localOrigins: string[]): Tool {
  return {
    exclusive: BROWSER_EXCLUSIVE,
    access: (args) =>
      isLocalOriginUrl(args.url, localOrigins) ? 'local' : 'network',
    definition: {
      name: 'browser_navigate',
      description:
        'ブラウザで URL を開き、ページの内容（アクセシビリティツリー）を返す。JavaScript で描くページも読める。' +
        '内容の [ref=e12] は要素の参照で、browser_click・browser_type・browser_select で要素を指すのに使う。' +
        '長いページは先頭だけを返すので、続きは browser_snapshot の offset で読む。' +
        (localOrigins.length > 0
          ? `手元の開発サーバー（${localOrigins.join(', ')}）も開ける。`
          : ''),
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: '開く URL（http:// または https:// で始まること）',
          },
        },
        required: ['url'],
      },
    },
    async execute(args, signal, context) {
      if (!context) return toolError(BROWSER_NO_CONTEXT_REASON);
      const parsed = parseBrowserUrl(args.url);
      if (!parsed.ok) return toolError(parsed.reason);

      const judgement = await judgeDestination(
        parsed.url.hostname,
        parsed.port,
        policyFor(context, localOrigins)
      );
      if (!judgement.allowed) return toolError(judgement.reason);

      const opened = await getSession(context, localOrigins);
      if (!opened.ok) {
        return opened.unavailable
          ? toolUnavailable(opened.reason)
          : toolError(opened.reason);
      }
      const { session } = opened;
      const page = await session.page();

      // page.goto は signal を受けないため、停止・タイムアウトではページを閉じて読み込みを止める
      // （同じ応答の次の呼び出しでは、セッションがページを開き直す）
      const abort = () => void page.close().catch(() => {});
      signal.addEventListener('abort', abort, { once: true });
      try {
        let status: number | undefined;
        try {
          await session.prepareNavigation(page, parsed.url.href);
          const response = await page.goto(parsed.url.href, {
            waitUntil: 'load',
            timeout: NAVIGATION_TIMEOUT_MS,
          });
          const blocked = response?.headers()[BROWSER_BLOCKED_HEADER];
          if (blocked) {
            return toolError(
              `転送の先（${new URL(response.url()).host}）は開けません: ${decodeURIComponent(blocked)}`
            );
          }
          status = response?.status();
        } catch (e) {
          // 開けなかったら、最上位のページの判定を今のページ（エラーのページ・元のページ）に合わせ直す
          session.syncTopPage(page);
          if (signal.aborted) return toolError('ページを開くのを中断しました');
          const lastBlocked = session.proxy.blocked.at(-1);
          const message = e instanceof Error ? e.message.split('\n')[0] : '';
          return toolError(
            `ページを開けませんでした: ${message}` +
              (lastBlocked ? `（止めた接続: ${lastBlocked}）` : '')
          );
        }
        await page
          .waitForLoadState('networkidle', {
            timeout: BROWSER_SETTLE_TIMEOUT_MS,
          })
          .catch(() => {});

        const url = page.url();
        const title = await page.title();
        const output = formatPageResult({
          url,
          title,
          status,
          snapshot: await takeSnapshot(page),
          offset: 0,
        });
        return {
          ...output,
          summary: output.isError
            ? output.summary
            : `${title || '（タイトルなし）'}（${new URL(url).host}）`,
          readLocal: session.isLocalUrl(url),
        };
      } catch (e) {
        if (signal.aborted) return toolError('ページを開くのを中断しました');
        return toolError(
          `ページを読めませんでした: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`
        );
      } finally {
        signal.removeEventListener('abort', abort);
      }
    },
  };
}
