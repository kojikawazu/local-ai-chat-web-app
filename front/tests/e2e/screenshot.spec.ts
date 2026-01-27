import { test, expect } from '@playwright/test';
import {
  cleanupAllConversations,
  createConversation,
  createMessage,
  sendMessage,
} from './helpers/test-data';

test.describe('スクリーンショットテスト', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('初期表示（会話なし状態）', async ({ page, request }) => {
      await cleanupAllConversations(request);
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/');

      // ウェルカム画面が表示されるまで待つ
      await expect(page.getByText('Welcome to Nordic.')).toBeVisible();

      await expect(page).toHaveScreenshot('initial-empty.png', {
        maxDiffPixelRatio: 0.05,
      });
    });

    test('チャット中（メッセージ複数件表示）', async ({ page, request }) => {
      await cleanupAllConversations(request);

      const conv = await createConversation(request, 'チャット表示テスト');
      await createMessage(request, conv.id, 'user', 'こんにちは！');
      await createMessage(
        request,
        conv.id,
        'assistant',
        'こんにちは！何かお手伝いできることはありますか？'
      );
      await createMessage(
        request,
        conv.id,
        'user',
        'TypeScriptについて教えてください。'
      );
      await createMessage(
        request,
        conv.id,
        'assistant',
        'TypeScriptはJavaScriptに型システムを追加したプログラミング言語です。静的型付けにより、開発時にエラーを早期発見できます。'
      );

      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/');
      await page.getByText('チャット表示テスト').click();
      await expect(page.getByText('こんにちは！').first()).toBeVisible({
        timeout: 10000,
      });

      await expect(page).toHaveScreenshot('chat-with-messages.png', {
        maxDiffPixelRatio: 0.05,
      });
    });

    test('サイドバー展開時', async ({ page, request }) => {
      await cleanupAllConversations(request);

      await createConversation(request, '会話1');
      await createConversation(request, '会話2');
      await createConversation(request, '会話3');

      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/');
      await expect(page.getByText('会話1')).toBeVisible({ timeout: 10000 });

      await expect(page).toHaveScreenshot('sidebar-with-conversations.png', {
        maxDiffPixelRatio: 0.05,
      });
    });
  });

  test.describe('準正常系', () => {
    test('エラー表示時', async ({ page }) => {
      // Ollama APIを失敗させてエラー状態を作る
      await page.route('**/api/chat', (route) => {
        route.fulfill({
          status: 502,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Ollamaへの接続に失敗しました',
          }),
        });
      });

      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/');

      await sendMessage(page, 'テスト');

      // エラーメッセージが表示されるまで待つ
      await expect(page.getByText('接続に失敗しました')).toBeVisible({
        timeout: 10000,
      });

      await expect(page).toHaveScreenshot('error-display.png', {
        maxDiffPixelRatio: 0.05,
      });
    });
  });

  test.describe('異常系', () => {
    test('モバイル表示', async ({ page, request }) => {
      await cleanupAllConversations(request);

      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/');

      // モバイルではウェルカム画面が表示される
      await expect(page.getByText('Welcome to Nordic.')).toBeVisible();

      await expect(page).toHaveScreenshot('mobile-view.png', {
        maxDiffPixelRatio: 0.05,
      });
    });
  });
});
