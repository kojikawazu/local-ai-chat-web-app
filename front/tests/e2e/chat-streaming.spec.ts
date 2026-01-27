import { test, expect } from '@playwright/test';
import {
  cleanupAllConversations,
  fillTextarea,
  sendMessage,
} from './helpers/test-data';

test.describe('ストリーミング表示', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('ストリーミングでAI応答がリアルタイムに表示される', async ({
      page,
    }) => {
      await page.goto('/');
      await sendMessage(page, 'Hello');

      // ユーザーメッセージ表示
      await expect(page.getByText('Hello').first()).toBeVisible({
        timeout: 10000,
      });

      // AI応答のコンテナが表示される（ストリーミング開始）
      const aiMessage = page.locator('[class*="bg-nord-2"]').first();
      await expect(aiMessage).toBeVisible({ timeout: 120000 });
    });

    test('AI応答の内容が空でない', async ({ page }) => {
      await page.goto('/');
      await sendMessage(page, 'Say hi');

      // AI応答を待機
      const aiMessage = page.locator('[class*="bg-nord-2"]').first();
      await expect(aiMessage).toBeVisible({ timeout: 120000 });

      // ストリーミング完了を待つ（送信ボタンが再度有効化される）
      const sendButton = page.locator('button[type="submit"]');
      await expect(sendButton).toBeEnabled({ timeout: 120000 });

      // AI応答にテキストが含まれる
      const aiContent = await aiMessage.textContent();
      expect(aiContent).toBeTruthy();
      expect(aiContent!.length).toBeGreaterThan(0);
    });

    test('ストリーミング完了後、完全なメッセージが表示される', async ({
      page,
    }) => {
      await page.goto('/');
      await sendMessage(page, '1+1=?');

      // ストリーミング完了を待つ
      const sendButton = page.locator('button[type="submit"]');
      await expect(sendButton).toBeEnabled({ timeout: 120000 });

      // ユーザーとAIの両方のメッセージが存在
      const userMessages = page.locator('[class*="bg-nord-frost-2"]');
      const aiMessages = page.locator('[class*="bg-nord-2"]');
      await expect(userMessages.first()).toBeVisible();
      await expect(aiMessages.first()).toBeVisible();

      // AI応答にコンテンツがある
      const aiContent = await aiMessages.first().textContent();
      expect(aiContent!.length).toBeGreaterThan(0);
    });
  });

  test.describe('準正常系', () => {
    test('短い応答が正しく表示される', async ({ page }) => {
      await page.goto('/');
      await sendMessage(page, 'Reply with just: OK');

      // ストリーミング完了を待つ
      const sendButton = page.locator('button[type="submit"]');
      await expect(sendButton).toBeEnabled({ timeout: 120000 });

      // AI応答が表示されている
      const aiMessage = page.locator('[class*="bg-nord-2"]').first();
      await expect(aiMessage).toBeVisible();
      const content = await aiMessage.textContent();
      expect(content!.length).toBeGreaterThan(0);
    });

    test('特殊文字を含む応答が正しく表示される', async ({ page }) => {
      await page.goto('/');
      await sendMessage(
        page,
        'Reply with these exact characters: & < > " and nothing else'
      );

      // ストリーミング完了を待つ
      const sendButton = page.locator('button[type="submit"]');
      await expect(sendButton).toBeEnabled({ timeout: 120000 });

      // AI応答が表示されている
      const aiMessage = page.locator('[class*="bg-nord-2"]').first();
      await expect(aiMessage).toBeVisible();
    });
  });

  test.describe('異常系', () => {
    test('Ollama接続エラー時にエラーメッセージが表示される', async ({
      page,
    }) => {
      // Ollama APIへのリクエストを失敗させる（goto前に設定）
      await page.route('**/api/chat', (route) => {
        route.fulfill({
          status: 502,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Ollamaへの接続に失敗しました',
          }),
        });
      });

      await page.goto('/');
      await sendMessage(page, 'テストメッセージ');

      // エラーメッセージが画面に表示される
      await expect(page.getByText('接続に失敗しました')).toBeVisible({
        timeout: 10000,
      });
    });
  });
});
