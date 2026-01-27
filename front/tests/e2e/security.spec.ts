import { test, expect } from '@playwright/test';
import {
  cleanupAllConversations,
  createConversation,
  createMessage,
  fillTextarea,
  sendMessage,
} from './helpers/test-data';

test.describe('セキュリティ', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('通常のテキストメッセージが正常に表示される', async ({
      page,
      request,
    }) => {
      await cleanupAllConversations(request);

      const conv = await createConversation(request, '通常テキスト');
      await createMessage(
        request,
        conv.id,
        'user',
        'これは通常のテキストです。'
      );
      await createMessage(
        request,
        conv.id,
        'assistant',
        'はい、通常のテキストですね。'
      );

      await page.goto('/');
      await page.getByText('通常テキスト').click();

      await expect(
        page.getByText('これは通常のテキストです。')
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.getByText('はい、通常のテキストですね。')
      ).toBeVisible();
    });
  });

  test.describe('準正常系', () => {
    test('HTMLタグを含むメッセージがエスケープされて表示される', async ({
      page,
      request,
    }) => {
      await cleanupAllConversations(request);

      const conv = await createConversation(request, 'HTMLテスト');
      await createMessage(
        request,
        conv.id,
        'user',
        '<b>bold</b> and <i>italic</i>'
      );

      await page.goto('/');
      await page.getByText('HTMLテスト').click();

      // HTMLタグがそのまま文字列として表示される（レンダリングされない）
      await expect(
        page.getByText('<b>bold</b> and <i>italic</i>')
      ).toBeVisible({ timeout: 10000 });

      // 太字のb要素としてレンダリングされていない
      const boldElements = page.locator(
        '[class*="whitespace-pre-wrap"] b'
      );
      await expect(boldElements).toHaveCount(0);
    });

    test('特殊文字（& < > " \'）が正しくエスケープされる', async ({
      page,
      request,
    }) => {
      await cleanupAllConversations(request);

      const specialChars = '& < > " \'';
      const conv = await createConversation(request, '特殊文字テスト');
      await createMessage(request, conv.id, 'user', specialChars);

      await page.goto('/');
      await page.getByText('特殊文字テスト').click();

      // 特殊文字がそのまま表示される
      await expect(page.getByText(specialChars)).toBeVisible({
        timeout: 10000,
      });
    });
  });

  test.describe('異常系', () => {
    test('XSSパターンが入力されてもスクリプトが実行されない', async ({
      page,
      request,
    }) => {
      await cleanupAllConversations(request);

      const xssPayload = "<script>alert('xss')</script>";
      const conv = await createConversation(request, 'XSSテスト');
      await createMessage(request, conv.id, 'user', xssPayload);

      // XSS検出用のグローバル変数をセット
      await page.addInitScript(() => {
        (window as unknown as { xssTriggered: boolean }).xssTriggered = false;
        window.alert = () => {
          (window as unknown as { xssTriggered: boolean }).xssTriggered = true;
        };
      });

      await page.goto('/');
      await page.getByText('XSSテスト').click();

      // scriptタグがそのまま文字列として表示される
      await expect(
        page.getByText("<script>alert('xss')</script>")
      ).toBeVisible({ timeout: 10000 });

      // alertが実行されていない
      const xssTriggered = await page.evaluate(
        () => (window as unknown as { xssTriggered: boolean }).xssTriggered
      );
      expect(xssTriggered).toBe(false);
    });

    test('10,001文字以上の入力がフロントエンドで制限される', async ({
      page,
    }) => {
      await page.goto('/');
      await fillTextarea(page, 'あ'.repeat(10001));

      // エラーメッセージが表示される
      await expect(
        page.getByText('文字以内で入力してください')
      ).toBeVisible();

      // 送信ボタンが無効化される
      const sendButton = page.locator('button[type="submit"]');
      await expect(sendButton).toBeDisabled();
    });

    test('SQLインジェクションパターンが入力されても安全に処理される', async ({
      page,
      request,
    }) => {
      await cleanupAllConversations(request);

      const sqlPayload = "'; DROP TABLE conversations; --";
      const conv = await createConversation(request, 'SQLiテスト');
      await createMessage(request, conv.id, 'user', sqlPayload);

      await page.goto('/');
      await page.getByText('SQLiテスト').click();

      // SQLインジェクションペイロードが安全に表示される
      await expect(
        page.getByText("'; DROP TABLE conversations; --")
      ).toBeVisible({ timeout: 10000 });

      // APIが正常に動作している（会話一覧が取得できる）
      const res = await request.get(
        'http://localhost:3000/api/conversations'
      );
      expect(res.status()).toBe(200);
    });

    test('CSPヘッダーが正しく設定されている', async ({ page }) => {
      const response = await page.goto('/');
      const cspHeader =
        response?.headers()['content-security-policy'];
      expect(cspHeader).toBeDefined();
      expect(cspHeader).toContain("default-src 'self'");
      expect(cspHeader).toContain("script-src 'self'");
      expect(cspHeader).toContain("style-src 'self' 'unsafe-inline'");
      expect(cspHeader).toContain("connect-src 'self'");
    });
  });
});
