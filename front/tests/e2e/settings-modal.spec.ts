import type { Page } from '@playwright/test';
import { test, expect } from '@playwright/test';

/**
 * 設定モーダル（共通の `Modal`。ネイティブの `<dialog>`）の開閉の E2E（#163）。
 *
 * 閉じ方（Close・×・Escape・背景のクリック）と、閉じた後のフォーカスの戻り先、
 * 開いている間にフォーカスが背景へ抜けないことを確かめる。
 * Ollama への通信を伴わないため、LLM の応答揺れに影響されない。
 */

/**
 * 設定モーダルのロケーター。
 *
 * @param page - 操作対象のページ
 * @returns 名前が「設定」のダイアログ
 */
const settings = (page: Page) => page.getByRole('dialog', { name: '設定' });

/**
 * サイドバーの設定ボタンのロケーター。
 *
 * @param page - 操作対象のページ
 * @returns 「設定を開く」ボタン
 */
const openButton = (page: Page) =>
  page.locator('aside').getByRole('button', { name: '設定を開く' });

/**
 * 設定モーダルを開く。
 *
 * @param page - 操作対象のページ
 */
async function openSettings(page: Page) {
  await openButton(page).click();
  await expect(settings(page)).toBeVisible();
}

/**
 * 背景（ダイアログの外）の座標。ダイアログは中央に出るため、画面の左上の角は必ず背景になる。
 */
const BACKDROP_POINT = { x: 8, y: 8 };

test.describe('設定モーダルの開閉', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test.describe('正常系', () => {
    for (const name of ['Close', '閉じる']) {
      test(`「${name}」ボタンで閉じ、フォーカスが設定ボタンへ戻る`, async ({
        page,
      }) => {
        await openSettings(page);
        await settings(page).getByRole('button', { name, exact: true }).click();

        await expect(settings(page)).toBeHidden();
        await expect(openButton(page)).toBeFocused();
      });
    }

    test('Escape で閉じ、フォーカスが設定ボタンへ戻る', async ({ page }) => {
      await openSettings(page);
      await page.keyboard.press('Escape');

      await expect(settings(page)).toBeHidden();
      await expect(openButton(page)).toBeFocused();
    });
  });

  test.describe('準正常系', () => {
    test('背景をクリックすると閉じる', async ({ page }) => {
      await openSettings(page);
      await page.mouse.click(BACKDROP_POINT.x, BACKDROP_POINT.y);

      await expect(settings(page)).toBeHidden();
    });

    test('ダイアログの中をクリックしても閉じない', async ({ page }) => {
      await openSettings(page);
      await settings(page).getByRole('heading', { name: 'Settings' }).click();

      await expect(settings(page)).toBeVisible();
    });

    test('中で押して背景で離しても（文字の選択など）閉じない', async ({
      page,
    }) => {
      await openSettings(page);
      const heading = await settings(page)
        .getByRole('heading', { name: 'Settings' })
        .boundingBox();
      if (!heading) throw new Error('見出しの位置を取得できませんでした');

      await page.mouse.move(heading.x + 4, heading.y + heading.height / 2);
      await page.mouse.down();
      await page.mouse.move(BACKDROP_POINT.x, BACKDROP_POINT.y);
      await page.mouse.up();

      await expect(settings(page)).toBeVisible();
    });
  });

  test.describe('異常系', () => {
    test('開いている間は Tab を押してもフォーカスが背景へ抜けない', async ({
      page,
    }) => {
      await openSettings(page);
      // 設定の中の操作できる要素の数より多く押し、一巡しても背景の要素へ移らないことを見る。
      // 最後の要素の次はブラウザの UI へ出ることがある（そのとき activeElement は body）ため、それは許す
      for (let i = 0; i < 20; i++) {
        await page.keyboard.press('Tab');
        const onBackground = await page.evaluate(() => {
          const el = document.activeElement;
          return el !== null && el !== document.body && !el.closest('dialog');
        });
        expect(onBackground).toBe(false);
      }
    });
  });
});
