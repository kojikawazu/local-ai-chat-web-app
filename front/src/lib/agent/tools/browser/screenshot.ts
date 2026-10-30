import type { Tool } from '../types';
import { toolError } from '../output';
import { getOpenedPage } from './session';
import { screenshotFromPng } from './capture';
import {
  BROWSER_EXCLUSIVE,
  BROWSER_NO_CONTEXT_REASON,
  BROWSER_NOT_OPENED_REASON,
  BROWSER_SCREENSHOT_TIMEOUT_MS,
  BROWSER_VIEWPORT,
} from '@/constants/agent/browser';

/**
 * この応答で開いたページの見えている範囲を撮り、モデルへ画像で渡すツールを作る（#149。`docs/18-browser-tools.md`）。
 *
 * 画像を読めるモデルにだけ渡す（`requiresVision`）。画像は結果の `images` に入れ、エージェントループが
 * `role: 'tool'` のメッセージに付ける。同じ画像を `screenshots` にも入れ、利用者にも見せる（#200）。ページ全体は撮らない（縦に長いページはトークンが大きくなるため）。
 *
 * @returns `browser_screenshot` のツール
 */
export function createBrowserScreenshotTool(): Tool {
  return {
    exclusive: BROWSER_EXCLUSIVE,
    requiresVision: true,
    definition: {
      name: 'browser_screenshot',
      description:
        'browser_navigate で開いたページの見えている範囲のスクリーンショットを撮り、画像で返す。' +
        '見た目（レイアウト・色・画像）を確かめるときに使う。文字を読むだけなら browser_snapshot を使う。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    async execute(_args, _signal, context) {
      if (!context) return toolError(BROWSER_NO_CONTEXT_REASON);
      const opened = await getOpenedPage(context);
      if (!opened) {
        return toolError(BROWSER_NOT_OPENED_REASON);
      }
      const { page, session } = opened;
      try {
        const image = await page.screenshot({
          type: 'png',
          timeout: BROWSER_SCREENSHOT_TIMEOUT_MS,
        });
        const url = page.url();
        const size = `${BROWSER_VIEWPORT.width}×${BROWSER_VIEWPORT.height}`;
        // モデルが見た画像を、利用者もそのまま見られるようにする（#200）
        const shown = screenshotFromPng(context, image, BROWSER_VIEWPORT);
        return {
          result: `スクリーンショット（${size}）を画像で渡しました。URL: ${url}`,
          isError: false,
          summary: `${size}（${new URL(url).host}）`,
          images: [image.toString('base64')],
          ...(shown && { screenshots: [shown] }),
          readLocal: session.isLocalUrl(url),
        };
      } catch (e) {
        return toolError(
          `スクリーンショットを撮れませんでした: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`
        );
      }
    },
  };
}
