import type { Tool } from '../types';
import { toolError } from '../output';
import { getOpenedPage } from './session';
import {
  BROWSER_NO_CONTEXT_REASON,
  BROWSER_VIEWPORT,
} from '@/constants/agent/browser';

/** スクリーンショットを撮るのに待つ時間（ミリ秒） */
const SCREENSHOT_TIMEOUT_MS = 10_000;

/**
 * この応答で開いたページの見えている範囲を撮り、モデルへ画像で渡すツールを作る（#149。`docs/18-browser-tools.md`）。
 *
 * 画像を読めるモデルにだけ渡す（`requiresVision`）。画像は結果の `images` に入れ、エージェントループが
 * `role: 'tool'` のメッセージに付ける（画面・DB へは送らない）。ページ全体は撮らない（縦に長いページはトークンが大きくなるため）。
 *
 * @returns `browser_screenshot` のツール
 */
export function createBrowserScreenshotTool(): Tool {
  return {
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
        return toolError('先に browser_navigate でページを開いてください');
      }
      const { page, session } = opened;
      try {
        const image = await page.screenshot({
          type: 'png',
          timeout: SCREENSHOT_TIMEOUT_MS,
        });
        const url = page.url();
        const size = `${BROWSER_VIEWPORT.width}×${BROWSER_VIEWPORT.height}`;
        return {
          result: `スクリーンショット（${size}）を画像で渡しました。URL: ${url}`,
          isError: false,
          summary: `${size}（${new URL(url).host}）`,
          images: [image.toString('base64')],
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
