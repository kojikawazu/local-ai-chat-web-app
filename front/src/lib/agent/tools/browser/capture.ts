import type { Locator, Page } from 'playwright-core';
import type { ScreenshotBox, ToolScreenshot } from '@/types/agent/tool-call';
import type { ToolContext } from '../types';
import {
  BROWSER_SCREENSHOT_JPEG_QUALITY,
  BROWSER_SCREENSHOT_TIMEOUT_MS,
  BROWSER_VIEWPORT,
} from '@/constants/agent/browser';
import { MAX_TOOL_SCREENSHOTS_PER_MESSAGE } from '@/lib/shared/validation';

/** 応答ごとの文脈（`scope`）に、この応答で撮った枚数を置くキー */
const COUNT_KEY = 'browser-screenshot-count';

/**
 * 操作の前の画面で、要素が見えるところまでスクロールするのに待つ時間（ミリ秒）。
 * 見えない要素（`display: none` 等）で待ち続けず、枠なしで撮る
 */
const SCROLL_TIMEOUT_MS = 2_000;

/** 画像の大きさ（px） */
type ImageSize = { width: number; height: number };

/**
 * 要素の位置を、画像の範囲に収めて整数にする（#200）。
 *
 * `boundingBox()` は見えている範囲の左上からの位置を返し、範囲の外にはみ出すことがある。
 * はみ出した分を切り、範囲に残らなければ（要素が画面の外・大きさが 0）枠を出さない。
 *
 * @param box - 要素の位置（見えている範囲の左上からの px）
 * @param size - 画像の大きさ
 * @returns 画像の中の位置。範囲に残らなければ `undefined`
 */
export function clampBox(
  box: ScreenshotBox,
  size: ImageSize
): ScreenshotBox | undefined {
  const left = Math.max(0, Math.round(box.x));
  const top = Math.max(0, Math.round(box.y));
  const right = Math.min(size.width, Math.round(box.x + box.width));
  const bottom = Math.min(size.height, Math.round(box.y + box.height));
  if (right <= left || bottom <= top) return undefined;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * この応答でまだ撮ってよいかを返す（1 回の応答で {@link MAX_TOOL_SCREENSHOTS_PER_MESSAGE} 枚まで）。
 *
 * @param context - 応答ごとの文脈
 * @returns 上限に達していなければ true
 */
function canCapture(context: ToolContext): boolean {
  return countOf(context) < MAX_TOOL_SCREENSHOTS_PER_MESSAGE;
}

/**
 * この応答で撮った枚数を返す。
 *
 * @param context - 応答ごとの文脈
 * @returns 枚数
 */
function countOf(context: ToolContext): number {
  const count = context.scope.get(COUNT_KEY);
  return typeof count === 'number' ? count : 0;
}

/**
 * 撮った画像を、利用者へ見せるスクリーンショットにする（枚数を数える）。
 *
 * @param context - 応答ごとの文脈
 * @param image - 画像の中身
 * @param shot - 画像の種類・形式・大きさ・要素の位置
 * @returns 中身付きのスクリーンショット
 */
function record(
  context: ToolContext,
  image: Buffer,
  shot: Omit<ToolScreenshot, 'id' | 'data'>
): ToolScreenshot {
  context.scope.set(COUNT_KEY, countOf(context) + 1);
  return { id: crypto.randomUUID(), ...shot, data: image.toString('base64') };
}

/**
 * 開いたページの見えている範囲を JPEG で撮り、利用者へ見せるスクリーンショットにする（#200。`docs/18-browser-tools.md`「画面をチャットに出す」）。
 *
 * 要素を渡すと、要素が見えるところまでスクロールしてから撮り、要素の位置（`box`）を付ける（承認カードの枠）。
 * 撮れなかった（時間切れ・ページが閉じた）・この応答の上限に達したときは `undefined` を返し、ツールの結果は失敗にしない。
 *
 * @param page - 撮るページ
 * @param context - 応答ごとの文脈（撮った枚数を数える）
 * @param kind - 操作の前（`before`）か、操作・ページを開いた後（`after`）か
 * @param locator - 操作する要素（`before` のとき）
 * @returns 中身付きのスクリーンショット。撮らなかったら `undefined`
 */
export async function captureScreen(
  page: Page,
  context: ToolContext,
  kind: ToolScreenshot['kind'],
  locator?: Locator
): Promise<ToolScreenshot | undefined> {
  if (!canCapture(context) || page.isClosed()) return undefined;
  const size = page.viewportSize() ?? BROWSER_VIEWPORT;
  try {
    let box: ScreenshotBox | undefined;
    if (locator) {
      await locator
        .scrollIntoViewIfNeeded({ timeout: SCROLL_TIMEOUT_MS })
        .catch(() => {});
      const found = await locator
        .boundingBox({ timeout: SCROLL_TIMEOUT_MS })
        .catch(() => null);
      box = found ? clampBox(found, size) : undefined;
    }
    const image = await page.screenshot({
      type: 'jpeg',
      quality: BROWSER_SCREENSHOT_JPEG_QUALITY,
      timeout: BROWSER_SCREENSHOT_TIMEOUT_MS,
    });
    return record(context, image, {
      kind,
      mimeType: 'image/jpeg',
      ...size,
      ...(box && { box }),
    });
  } catch {
    return undefined;
  }
}

/**
 * `browser_screenshot` がモデルへ渡す PNG を、そのまま利用者へ見せるスクリーンショットにする（#200）。
 *
 * @param context - 応答ごとの文脈（撮った枚数を数える）
 * @param png - モデルへ渡す PNG
 * @param size - 画像の大きさ
 * @returns 中身付きのスクリーンショット。この応答の上限に達していたら `undefined`
 */
export function screenshotFromPng(
  context: ToolContext,
  png: Buffer,
  size: ImageSize
): ToolScreenshot | undefined {
  if (!canCapture(context)) return undefined;
  return record(context, png, {
    kind: 'after',
    mimeType: 'image/png',
    ...size,
  });
}
