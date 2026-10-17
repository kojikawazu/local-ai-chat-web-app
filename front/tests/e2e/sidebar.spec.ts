import { test, expect } from '@playwright/test';
import {
  cleanupAllConversations,
  createConversation,
  createMessage,
  deleteConversation,
} from './helpers/test-data';
import type { Page } from '@playwright/test';

/**
 * サイドバーの会話行の削除ボタンを押す。
 *
 * @param page - 対象のページ
 * @param title - 削除する会話のタイトル
 */
async function clickDeleteButton(page: Page, title: string): Promise<void> {
  // 会話行をホバーして削除ボタンを表示し、2 番目の button（Trash2 アイコン）を押す
  const convRow = page.locator('[class*="group"]', { hasText: title }).first();
  await convRow.hover();
  await convRow.locator('button').nth(1).click();
}

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

      await clickDeleteButton(page, '削除対象の会話');

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

    test('別タブ等で既に削除された会話を削除すると、404 でも一覧から消える', async ({
      page,
      request,
    }) => {
      await cleanupAllConversations(request);
      const conv = await createConversation(request, '削除済みの会話');
      await page.goto('/');
      await expect(page.getByText('削除済みの会話')).toBeVisible({
        timeout: 10000,
      });

      // 画面を開いたまま API で先に消し、削除 API が 404 を返す状態にする（#97）
      await deleteConversation(request, conv.id);

      const deleteResponse = page.waitForResponse(
        (res) =>
          res.url().endsWith(`/api/conversations/${conv.id}`) &&
          res.request().method() === 'DELETE'
      );
      await clickDeleteButton(page, '削除済みの会話');
      expect((await deleteResponse).status()).toBe(404);

      // 一覧に残すと、押しても消えない項目になる
      await expect(page.getByText('削除済みの会話')).toHaveCount(0, {
        timeout: 10000,
      });
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

    test('削除 API がサーバーエラーを返すと、会話を一覧に残す', async ({
      page,
      request,
    }) => {
      await cleanupAllConversations(request);
      await createConversation(request, '削除に失敗する会話');

      // 実 DB を安定して壊せないため、境界（削除 API）で障害を注入する。
      // 404（既に削除済み）と違い、500 では会話が DB に残っているので一覧からも消さない
      await page.route('**/api/conversations/*', (route) => {
        if (route.request().method() === 'DELETE') {
          route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: '会話の削除に失敗しました' }),
          });
        } else {
          route.continue();
        }
      });

      await page.goto('/');
      await expect(page.getByText('削除に失敗する会話')).toBeVisible({
        timeout: 10000,
      });

      const deleteResponse = page.waitForResponse(
        (res) => res.request().method() === 'DELETE'
      );
      await clickDeleteButton(page, '削除に失敗する会話');
      expect((await deleteResponse).status()).toBe(500);

      await expect(page.getByText('削除に失敗する会話')).toBeVisible();
    });
  });
});
