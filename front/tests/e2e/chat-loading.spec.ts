import { test, expect } from '@playwright/test';
import { cleanupAllConversations, sendMessage } from './helpers/test-data';

test.describe('ローディングアニメーション', () => {
  test.setTimeout(120000);

  test.beforeAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('メッセージ送信後にローディングアニメーションが表示される', async ({
      page,
    }) => {
      await page.goto('/');

      // メッセージを送信（応答を待たない）
      await sendMessage(page, 'こんにちは');

      // ローディングアニメーション（ドットバウンス）が表示されることを確認
      const loadingIndicator = page.getByLabel('応答を生成中');
      await expect(loadingIndicator).toBeVisible({ timeout: 10000 });
    });

    test('AI応答完了後にローディングアニメーションが消える', async ({
      page,
    }) => {
      await page.goto('/');
      await sendMessage(page, 'はい');

      // アニメーションが一時的に表示される
      const loadingIndicator = page.getByLabel('応答を生成中');
      await expect(loadingIndicator).toBeVisible({ timeout: 10000 });

      // 応答完了後にアニメーションが消え、AI応答テキストが表示される
      await expect(loadingIndicator).not.toBeVisible({ timeout: 90000 });
      const aiMessages = page.locator('[class*="bg-nord-2"]');
      await expect(aiMessages.first()).toBeVisible();
    });
  });

  test.describe('準正常系', () => {
    test('ローディング中はコピーボタンが表示されない', async ({ page }) => {
      await page.goto('/');
      await sendMessage(page, 'テスト');

      const loadingIndicator = page.getByLabel('応答を生成中');
      await expect(loadingIndicator).toBeVisible({ timeout: 10000 });

      // ローディング中はコピーボタンが表示されない（isThisWaiting=true の場合に非表示）
      const copyButton = page.locator('button[aria-label="コピー"]').last();
      await expect(copyButton).not.toBeVisible();
    });
  });

  test.describe('異常系', () => {
    test('ウェルカム画面ではローディングアニメーションが表示されない', async ({
      request,
      page,
    }) => {
      await cleanupAllConversations(request);
      await page.goto('/');

      // 会話がない状態ではウェルカム画面が表示され、アニメーションは表示されない
      await expect(page.getByText('Nordic Chat へようこそ')).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByLabel('応答を生成中')).not.toBeVisible();
    });
  });
});
