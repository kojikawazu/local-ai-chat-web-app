import { test, expect } from '@playwright/test';
import {
  cleanupAllConversations,
  createConversation,
  createMessage,
} from './helpers/test-data';

test.describe('サイドバー操作', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('会話一覧が表示される', async ({ page, request }) => {
      await cleanupAllConversations(request);
      await createConversation(request, '会話A');
      await createConversation(request, '会話B');

      await page.goto('/');

      await expect(page.getByText('会話A')).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('会話B')).toBeVisible();
    });

    test('会話を選択して切り替えできる', async ({ page, request }) => {
      await cleanupAllConversations(request);

      const conv1 = await createConversation(request, '会話1');
      const conv2 = await createConversation(request, '会話2');
      await createMessage(request, conv1.id, 'user', 'メッセージ1');
      await createMessage(request, conv2.id, 'user', 'メッセージ2');

      await page.goto('/');

      // 会話1を選択
      await page.getByText('会話1').click();
      await expect(page.getByText('メッセージ1')).toBeVisible({
        timeout: 10000,
      });

      // 会話2に切り替え
      await page.getByText('会話2').click();
      await expect(page.getByText('メッセージ2')).toBeVisible({
        timeout: 10000,
      });
    });

    test('新規会話を作成できる', async ({ page, request }) => {
      // 既存会話がある状態にする（初期状態ではNew Conversationボタンが無効）
      await cleanupAllConversations(request);
      const conv = await createConversation(request, 'テスト会話');
      await createMessage(request, conv.id, 'user', 'テスト');

      await page.goto('/');
      // 既存会話を選択してNew Conversationボタンを有効化
      await page.getByText('テスト会話').click();
      await expect(page.getByText('テスト')).toBeVisible({ timeout: 10000 });

      // New Conversationボタンをクリック
      await page.getByText('New Conversation').click();

      // ウェルカム画面が表示される（空の会話状態）
      await expect(page.getByText('Nordic Chat へようこそ')).toBeVisible();
    });

    test('会話を削除できる', async ({ page, request }) => {
      await cleanupAllConversations(request);

      await createConversation(request, '削除対象の会話');
      await page.goto('/');

      await expect(page.getByText('削除対象の会話')).toBeVisible({
        timeout: 10000,
      });

      // 会話行をホバーして削除ボタンを表示
      const convRow = page
        .locator('[class*="group"]', { hasText: '削除対象の会話' })
        .first();
      await convRow.hover();

      // 削除ボタンをクリック（2番目のbutton = Trash2アイコン）
      await convRow.locator('button').nth(1).click();

      // 会話が一覧から消える
      await expect(page.getByText('削除対象の会話')).toHaveCount(0, {
        timeout: 10000,
      });
    });
  });

  test.describe('準正常系', () => {
    test('会話が0件のときにウェルカム画面が表示される', async ({
      page,
      request,
    }) => {
      await cleanupAllConversations(request);

      await page.goto('/');

      // ウェルカムメッセージが表示される
      await expect(page.getByText('Nordic Chat へようこそ')).toBeVisible();
    });
  });

  test.describe('異常系', () => {
    test('API通信エラー時にクラッシュしない', async ({ page }) => {
      // 会話一覧APIを失敗させる（goto前に設定）
      await page.route('**/api/conversations', (route) => {
        if (route.request().method() === 'GET') {
          route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'サーバーエラー' }),
          });
        } else {
          route.continue();
        }
      });

      await page.goto('/');

      // ページがクラッシュせず表示される
      await expect(page.locator('header')).toBeVisible();
      await expect(page.locator('textarea')).toBeVisible();
    });
  });
});
