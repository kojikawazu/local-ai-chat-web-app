import type { Page } from '@playwright/test';
import { test, expect } from '@playwright/test';

/**
 * テーマ切替の E2E。
 *
 * `types/theme.ts` の THEMES / ThemeId と `globals.css` の `[data-theme='...']`
 * セレクタが一致していること、および localStorage への永続化が働くことを検証する。
 * 既定テーマ（nordic）は `data-theme` 属性を付けないことで表現する契約なので、
 * 「属性なし = nordic」を期待値として扱う。
 *
 * Ollama への通信を伴わないため、LLM の応答揺れに影響されない。
 */
const STORAGE_KEY = 'nordic-chat-theme';

/**
 * 設定モーダルを開く。サイドバーの設定ボタンが唯一の入口。
 *
 * @param page - 操作対象のページ
 */
async function openSettings(page: Page) {
  await page.getByLabel('設定を開く').click();
  await expect(page.getByRole('dialog', { name: '設定' })).toBeVisible();
}

test.describe('テーマ切替', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // 前テストの保存値を持ち越さない
    await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
    await page.reload();
  });

  test.describe('正常系', () => {
    test('Aurora に切り替えると data-theme が付き localStorage に保存される', async ({
      page,
    }) => {
      await openSettings(page);
      await page.getByRole('button', { name: /Aurora Borealis/ }).click();

      await expect(page.locator('html')).toHaveAttribute(
        'data-theme',
        'aurora'
      );
      expect(
        await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)
      ).toBe('aurora');
    });

    test('リロードしても選択したテーマが復元される', async ({ page }) => {
      await openSettings(page);
      await page.getByRole('button', { name: /Midnight Ocean/ }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'ocean');

      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'ocean');
    });
  });

  test.describe('準正常系', () => {
    test('既定テーマ（Nordic Frost）に戻すと data-theme 属性が外れる', async ({
      page,
    }) => {
      await openSettings(page);
      await page.getByRole('button', { name: /Aurora Borealis/ }).click();
      await expect(page.locator('html')).toHaveAttribute(
        'data-theme',
        'aurora'
      );

      await page.getByRole('button', { name: /Nordic Frost/ }).click();
      // 既定テーマは「属性を外す」ことで表現する
      await expect(page.locator('html')).not.toHaveAttribute(
        'data-theme',
        /.*/
      );
      expect(
        await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)
      ).toBe('nordic');
    });

    test('テーマ未保存の初回訪問では data-theme 属性が無い', async ({
      page,
    }) => {
      await expect(page.locator('html')).not.toHaveAttribute(
        'data-theme',
        /.*/
      );
    });
  });

  test.describe('異常系', () => {
    test('localStorage に不正なテーマ ID があっても既定テーマで復帰する', async ({
      page,
    }) => {
      // isThemeId のガードが効かないと `as ThemeId` 相当の値が DOM に流れ込む
      await page.evaluate(
        ([key, value]) => localStorage.setItem(key, value),
        [STORAGE_KEY, 'not-a-theme']
      );
      await page.reload();

      await expect(page.locator('html')).not.toHaveAttribute(
        'data-theme',
        /.*/
      );
    });
  });
});
