import { test, expect } from '@playwright/test';
import {
  cleanupAllConversations,
  createConversation,
  createMessage,
  fetchMessages,
  sendMessage,
} from './helpers/test-data';

test.describe('会話管理', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('新規会話を作成してメッセージを送信できる', async ({
      page,
      request,
    }) => {
      await cleanupAllConversations(request);
      await page.goto('/');

      // メッセージを送信（自動的に会話が作成される）
      await sendMessage(page, '新規会話テスト');

      // ユーザーメッセージが表示される
      await expect(page.getByText('新規会話テスト').first()).toBeVisible({
        timeout: 10000,
      });

      // サイドバーに会話が追加される
      await expect(
        page.locator('nav').locator('[class*="group"]').first()
      ).toBeVisible({ timeout: 10000 });
    });

    test('会話を切り替えると対応するメッセージが表示される', async ({
      page,
      request,
    }) => {
      await cleanupAllConversations(request);

      const conv1 = await createConversation(request, '会話Alpha');
      const conv2 = await createConversation(request, '会話Beta');
      await createMessage(request, conv1.id, 'user', 'Alphaのメッセージ');
      await createMessage(request, conv2.id, 'user', 'Betaのメッセージ');

      await page.goto('/');

      await page.getByText('会話Alpha').click();
      await expect(page.getByText('Alphaのメッセージ')).toBeVisible({
        timeout: 10000,
      });

      await page.getByText('会話Beta').click();
      await expect(page.getByText('Betaのメッセージ')).toBeVisible({
        timeout: 10000,
      });
      // Alphaのメッセージは表示されない
      await expect(page.getByText('Alphaのメッセージ')).toHaveCount(0);
    });

    test('会話を削除するとメッセージも消える', async ({ page, request }) => {
      await cleanupAllConversations(request);

      const conv = await createConversation(request, '削除テスト会話');
      await createMessage(request, conv.id, 'user', '削除されるメッセージ');

      await page.goto('/');

      // 会話を選択してメッセージ確認
      await page.getByText('削除テスト会話').click();
      await expect(page.getByText('削除されるメッセージ')).toBeVisible({
        timeout: 10000,
      });

      // 会話を削除
      const convRow = page
        .locator('[class*="group"]', { hasText: '削除テスト会話' })
        .first();
      await convRow.hover();
      await convRow.locator('button').nth(1).click();

      // 会話とメッセージが消える
      await expect(page.getByText('削除テスト会話')).toHaveCount(0, {
        timeout: 10000,
      });
      await expect(page.getByText('削除されるメッセージ')).toHaveCount(0);
    });

    test('ページリロード後も会話履歴が保持される', async ({
      page,
      request,
    }) => {
      await cleanupAllConversations(request);

      const conv = await createConversation(request, '永続化テスト');
      await createMessage(request, conv.id, 'user', '永続化メッセージ');
      await createMessage(request, conv.id, 'assistant', '永続化応答');

      await page.goto('/');
      await page.getByText('永続化テスト').click();
      await expect(page.getByText('永続化メッセージ')).toBeVisible({
        timeout: 10000,
      });

      // リロード
      await page.reload();

      // 会話一覧に残っている
      await expect(page.getByText('永続化テスト')).toBeVisible({
        timeout: 10000,
      });

      // 会話を再度選択してメッセージが残っている
      await page.getByText('永続化テスト').click();
      await expect(page.getByText('永続化メッセージ')).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByText('永続化応答')).toBeVisible();
    });
  });

  test.describe('準正常系', () => {
    test('長文メッセージ（10,000文字）がDBに保存・表示される', async ({
      request,
      page,
    }) => {
      await cleanupAllConversations(request);

      const longText = 'A'.repeat(10000);
      const conv = await createConversation(request, '長文テスト');
      await createMessage(request, conv.id, 'user', longText);

      // DB側で保存されていることを確認
      const messages = await fetchMessages(request, conv.id);
      expect(messages.length).toBe(1);
      expect(messages[0].content.length).toBe(10000);

      // UIでも表示される
      await page.goto('/');
      await page.getByText('長文テスト').click();

      const userMessage = page.locator('[class*="bg-nord-frost-2"]').first();
      await expect(userMessage).toBeVisible({ timeout: 10000 });
    });

    test('会話タイトルが未指定の場合、デフォルトタイトルが使われる', async ({
      request,
    }) => {
      const conv = await createConversation(request);
      expect(conv.title).toBe('テスト会話');
    });
  });

  test.describe('異常系', () => {
    test('削除済み会話のメッセージ取得でエラーが返る', async ({ request }) => {
      const conv = await createConversation(request, '削除対象');
      const convId = conv.id;

      // 削除
      await request.delete(
        `http://localhost:3000/api/conversations/${convId}`
      );

      // メッセージ取得を試みる
      const res = await request.get(
        `http://localhost:3000/api/conversations/${convId}/messages`
      );
      expect(res.status()).toBe(404);
    });

    test('存在しないUUIDで会話削除するとエラーが返る', async ({ request }) => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await request.delete(
        `http://localhost:3000/api/conversations/${fakeId}`
      );
      expect(res.status()).toBe(500);
    });
  });
});
