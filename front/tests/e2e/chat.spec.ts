import { test, expect } from '@playwright/test';
import {
  cleanupAllConversations,
  createConversation,
  createMessage,
  fillTextarea,
  sendMessage,
} from './helpers/test-data';

test.describe('チャット機能', () => {
  // LLM応答を待つテストがあるため長めのタイムアウト
  test.setTimeout(180000);

  test.beforeAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('送信ボタンでメッセージを送信できる', async ({ page }) => {
      await page.goto('/');
      await fillTextarea(page, 'こんにちは');

      const sendButton = page.locator('button[type="submit"]');
      await expect(sendButton).toBeEnabled();
      await sendButton.click();

      // ユーザーメッセージが表示される
      await expect(page.getByText('こんにちは').first()).toBeVisible({
        timeout: 10000,
      });

      // AI応答が表示されるまで待機（ストリーミングのため長めに待つ）
      const aiMessages = page.locator('[class*="bg-nord-2"]');
      await expect(aiMessages.first()).toBeVisible({ timeout: 120000 });
    });

    test('Enterキーでメッセージを送信できる', async ({ page }) => {
      await page.goto('/');
      await sendMessage(page, 'テスト送信');

      await expect(page.getByText('テスト送信').first()).toBeVisible({
        timeout: 10000,
      });
    });

    test('Shift+Enterで改行できる（送信されない）', async ({
      page,
      request,
    }) => {
      await cleanupAllConversations(request);
      await page.goto('/');

      // ウェルカム画面が表示されるまで待つ（前テストの状態がクリアされたことを確認）
      await expect(page.getByText('Nordic Chat へようこそ')).toBeVisible({
        timeout: 10000,
      });

      const textarea = page.locator('textarea');
      await textarea.click();
      await textarea.pressSequentially('Line1', { delay: 30 });
      await page.waitForTimeout(200);

      // Shift+Enter を明示的に Shift down → Enter → Shift up で実行
      await page.keyboard.down('Shift');
      await page.keyboard.press('Enter');
      await page.keyboard.up('Shift');
      await page.waitForTimeout(200);

      await textarea.pressSequentially('Line2', { delay: 30 });
      await page.waitForTimeout(200);

      // テキストエリアに改行を含むテキストがある（送信されていればtextareaは空になる）
      const value = await textarea.inputValue();
      expect(value).toContain('Line1');
      expect(value).toContain('Line2');
    });

    test('メッセージ送信後にチャットエリアが自動スクロールする', async ({
      page,
      request,
    }) => {
      await cleanupAllConversations(request);

      // 既存会話にメッセージを複数追加してスクロールが必要な状態を作る
      const conv = await createConversation(request, 'スクロールテスト');
      for (let i = 0; i < 10; i++) {
        await createMessage(request, conv.id, 'user', `メッセージ ${i + 1}`);
        await createMessage(
          request,
          conv.id,
          'assistant',
          `応答 ${i + 1} - ${'長いテキスト。'.repeat(20)}`
        );
      }

      await page.goto('/');

      // サイドバーから会話を選択
      await page.getByText('スクロールテスト').click();
      await expect(
        page.getByText('メッセージ 10', { exact: true }).first()
      ).toBeVisible({
        timeout: 10000,
      });

      // スクロールコンテナの末尾が見えていることを確認
      const scrollContainer = page
        .locator('[class*="overflow-y-auto"]')
        .first();
      const isScrolledToBottom = await scrollContainer.evaluate((el) => {
        return Math.abs(el.scrollHeight - el.scrollTop - el.clientHeight) < 50;
      });
      expect(isScrolledToBottom).toBe(true);
    });
  });

  test.describe('準正常系', () => {
    test('最大文字数（10,000文字）ちょうどのメッセージを入力できる', async ({
      page,
    }) => {
      await page.goto('/');
      await fillTextarea(page, 'あ'.repeat(10000));

      // エラーメッセージが表示されない
      await expect(
        page.getByText('文字以内で入力してください')
      ).toHaveCount(0);

      // 送信ボタンが有効
      const sendButton = page.locator('button[type="submit"]');
      await expect(sendButton).toBeEnabled();
    });

    test('前後に空白があるメッセージが送信される', async ({ page }) => {
      await page.goto('/');
      await fillTextarea(page, '  テスト  ');

      const sendButton = page.locator('button[type="submit"]');
      await expect(sendButton).toBeEnabled();
    });
  });

  test.describe('異常系', () => {
    test('空のメッセージは送信できない', async ({ page }) => {
      await page.goto('/');

      const sendButton = page.locator('button[type="submit"]');
      await expect(sendButton).toBeDisabled();

      // 空白のみでも送信不可
      await fillTextarea(page, '   ');
      await expect(sendButton).toBeDisabled();
    });

    test('10,000文字を超えるメッセージは送信できない', async ({ page }) => {
      await page.goto('/');
      await fillTextarea(page, 'あ'.repeat(10001));

      // エラーメッセージが表示される
      await expect(
        page.getByText('文字以内で入力してください')
      ).toBeVisible();

      // 送信ボタンが無効
      const sendButton = page.locator('button[type="submit"]');
      await expect(sendButton).toBeDisabled();
    });
  });
});
