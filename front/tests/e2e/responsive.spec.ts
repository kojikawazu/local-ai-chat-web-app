import { test, expect } from '@playwright/test';
import {
  cleanupAllConversations,
  createConversation,
  createMessage,
  fillTextarea,
} from './helpers/test-data';

test.describe('レスポンシブ・画面表示', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('デスクトップ表示でレイアウトが正しい', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/');

      // サイドバーが表示される（md以上）
      await expect(page.locator('aside')).toBeVisible();

      // ヘッダーが表示される
      await expect(page.locator('header')).toBeVisible();

      // チャットエリアが表示される
      await expect(
        page.locator('[class*="overflow-y-auto"]').first()
      ).toBeVisible();

      // フッターが表示される
      await expect(page.locator('footer')).toBeVisible();

      // 入力エリアが表示される
      await expect(page.locator('textarea')).toBeVisible();
    });

    test('サイドバーにタイトルとボタンが表示される', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/');

      await expect(page.getByText('Nordic Chat')).toBeVisible();
      await expect(page.getByText('New Conversation')).toBeVisible();
      await expect(page.getByText('History')).toBeVisible({
        timeout: 5000,
      });
    });
  });

  test.describe('準正常系', () => {
    test('ウィンドウサイズを変更した際にレイアウトが追従する', async ({
      page,
    }) => {
      // デスクトップ表示
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/');
      await expect(page.locator('aside')).toBeVisible();

      // モバイル幅に縮小
      await page.setViewportSize({ width: 375, height: 667 });

      // サイドバーが非表示になる（hidden md:flex）
      await expect(page.locator('aside')).toBeHidden();

      // メインコンテンツは表示される
      await expect(page.locator('header')).toBeVisible();
      await expect(page.locator('textarea')).toBeVisible();

      // デスクトップに戻す
      await page.setViewportSize({ width: 1280, height: 720 });
      await expect(page.locator('aside')).toBeVisible();
    });

    test('非常に長いメッセージでもレイアウトが崩れない', async ({
      page,
      request,
    }) => {
      await cleanupAllConversations(request);

      const longMessage = '長いメッセージ '.repeat(500);
      const conv = await createConversation(request, '長文レイアウト');
      await createMessage(request, conv.id, 'user', longMessage);

      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/');
      await page.getByText('長文レイアウト').click();

      // メッセージが表示される
      const userMessage = page.locator('[class*="bg-nord-frost-2"]').first();
      await expect(userMessage).toBeVisible({ timeout: 10000 });

      // メッセージがビューポートの幅を超えていない
      const messageBox = await userMessage.boundingBox();
      expect(messageBox).toBeTruthy();
      expect(messageBox!.width).toBeLessThanOrEqual(1280);

      // ヘッダーとフッターが表示されている
      await expect(page.locator('header')).toBeVisible();
      await expect(page.locator('footer')).toBeVisible();
    });
  });

  test.describe('異常系', () => {
    test('極端に狭いビューポート（320px幅）でもクラッシュしない', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 320, height: 568 });
      await page.goto('/');

      // ページがクラッシュせず要素が表示される
      await expect(page.locator('header')).toBeVisible();
      await expect(page.locator('textarea')).toBeVisible();
      await expect(page.locator('footer')).toBeVisible();

      // 入力・送信が可能
      await fillTextarea(page, 'テスト');
      const sendButton = page.locator('button[type="submit"]');
      await expect(sendButton).toBeEnabled();
    });

    test('モバイル表示で操作不能な要素がない', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/');

      // テキストエリアにフォーカスして入力できる
      await fillTextarea(page, 'モバイルテスト');

      const textarea = page.locator('textarea');
      const value = await textarea.inputValue();
      expect(value).toBe('モバイルテスト');

      // 送信ボタンがクリック可能
      const sendButton = page.locator('button[type="submit"]');
      await expect(sendButton).toBeEnabled();

      const box = await sendButton.boundingBox();
      expect(box).toBeTruthy();
      // タッチターゲットが十分な大きさ
      expect(box!.width).toBeGreaterThanOrEqual(30);
      expect(box!.height).toBeGreaterThanOrEqual(30);
    });
  });
});
