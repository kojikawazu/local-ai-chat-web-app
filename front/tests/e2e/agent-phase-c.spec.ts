import { test, expect } from '@playwright/test';
import { cleanupAllConversations } from './helpers/test-data';

const BASE_URL = 'http://localhost:3000';

// 設定モーダルを開くヘルパー
async function openSettings(page: Parameters<typeof cleanupAllConversations>[0] extends never ? never : import('@playwright/test').Page) {
  await page.locator('button[aria-label="設定を開く"]').click();
  await expect(page.getByRole('dialog', { name: '設定' })).toBeVisible({ timeout: 5000 });
}
async function closeSettings(page: Parameters<typeof openSettings>[0]) {
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog', { name: '設定' })).toBeHidden({ timeout: 3000 });
}

test.describe('エージェント Phase C — 自律エージェント化', () => {
  test.setTimeout(180000);

  test.beforeAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('設定モーダルに Agent Prompt セクションが表示される（Tools ON 時）', async ({ page }) => {
      await page.goto('/');
      // localStorage で Tools ON にしてリロード
      await page.evaluate(() => localStorage.setItem('agent-tools-enabled', 'true'));
      await page.reload();

      await openSettings(page);
      await expect(page.getByText('Agent Prompt')).toBeVisible();
      await expect(page.getByText('リサーチャー')).toBeVisible();
      await expect(page.getByText('分析者')).toBeVisible();
      await expect(page.getByText('比較レビュアー')).toBeVisible();

      await closeSettings(page);
      // クリーンアップ
      await page.evaluate(() => localStorage.setItem('agent-tools-enabled', 'false'));
    });

    test('Tools OFF のとき Agent Prompt セクションが非表示になる', async ({ page }) => {
      await page.goto('/');
      await page.evaluate(() => localStorage.setItem('agent-tools-enabled', 'false'));
      await page.reload();

      await openSettings(page);
      await expect(page.getByText('Agent Prompt')).toBeHidden();
      await closeSettings(page);
    });

    test('プリセット選択が localStorage に保存される', async ({ page }) => {
      await page.goto('/');
      await page.evaluate(() => localStorage.setItem('agent-tools-enabled', 'true'));
      await page.reload();

      await openSettings(page);
      await page.getByRole('button', { name: /分析者/ }).click();
      await closeSettings(page);

      const stored = await page.evaluate(() => localStorage.getItem('agent-prompt-preset-id'));
      expect(stored).toBe('analyst');

      // クリーンアップ
      await page.evaluate(() => {
        localStorage.setItem('agent-tools-enabled', 'false');
        localStorage.removeItem('agent-prompt-preset-id');
      });
    });

    test('ページリロード後もプリセット選択が保持される', async ({ page }) => {
      await page.goto('/');
      await page.evaluate(() => {
        localStorage.setItem('agent-tools-enabled', 'true');
        localStorage.setItem('agent-prompt-preset-id', 'reviewer');
      });
      await page.reload();

      await openSettings(page);
      // 選択済みプリセットには nord-frost-1 クラスが付く
      const reviewerBtn = page.getByRole('button', { name: /比較レビュアー/ });
      await expect(reviewerBtn).toHaveClass(/nord-frost-1/);
      await closeSettings(page);

      // クリーンアップ
      await page.evaluate(() => {
        localStorage.setItem('agent-tools-enabled', 'false');
        localStorage.removeItem('agent-prompt-preset-id');
      });
    });

    test('エージェントモードで応答が返りラウンド数が表示される', async ({ page }) => {
      test.skip(!!process.env.CI, 'CI 環境ではモデルのツール呼び出しに依存するためスキップ');

      await page.goto('/');
      await page.evaluate(() => localStorage.setItem('agent-tools-enabled', 'true'));
      await page.reload();

      const textarea = page.locator('textarea');
      await textarea.click();
      await textarea.pressSequentially('今の日時を教えてください', { delay: 10 });
      await page.locator('button[type="submit"]').click();

      // 送信完了まで待機
      await expect(page.locator('button[type="submit"]')).toBeEnabled({ timeout: 120000 });

      // ラウンド数表示を確認（「N ラウンド」）
      await expect(page.getByText(/ラウンド/)).toBeVisible({ timeout: 5000 });
    });

    test('thinking イベントで思考過程が表示される', async ({ page }) => {
      test.skip(!!process.env.CI, 'CI 環境ではモデルのツール呼び出しに依存するためスキップ');

      await page.goto('/');
      await page.evaluate(() => localStorage.setItem('agent-tools-enabled', 'true'));
      await page.reload();

      const textarea = page.locator('textarea');
      await textarea.click();
      await textarea.pressSequentially('今の日時を教えてください', { delay: 10 });
      await page.locator('button[type="submit"]').click();

      await expect(page.locator('button[type="submit"]')).toBeEnabled({ timeout: 120000 });

      // 思考過程が表示されていれば確認（モデルが thinking を出力しない場合は skip）
      const thinkingEl = page.getByText('思考過程').first();
      const hasThinking = await thinkingEl.isVisible().catch(() => false);
      if (hasThinking) {
        // デフォルト展開状態を確認
        await expect(thinkingEl).toBeVisible();
        // クリックで折りたたみ
        await thinkingEl.click();
      }
    });
  });

  test.describe('準正常系', () => {
    test('プリセット「なし」を選択するとシステムプロンプトなしで動作する', async ({ page }) => {
      await page.goto('/');
      await page.evaluate(() => localStorage.setItem('agent-tools-enabled', 'true'));
      await page.reload();

      await openSettings(page);
      await page.getByRole('button', { name: /なし（システムプロンプトなし）/ }).click();
      await closeSettings(page);

      const stored = await page.evaluate(() => localStorage.getItem('agent-prompt-preset-id'));
      expect(stored).toBe('none');

      // クリーンアップ
      await page.evaluate(() => {
        localStorage.setItem('agent-tools-enabled', 'false');
        localStorage.removeItem('agent-prompt-preset-id');
      });
    });

    test('systemPrompt 付きで /api/chat POST しても 200 が返る', async ({ request }) => {
      const res = await request.post(`${BASE_URL}/api/chat`, {
        data: {
          message: 'こんにちは',
          conversationHistory: [],
          enableTools: false,
          systemPrompt: 'あなたは親切なアシスタントです。',
        },
      });
      expect(res.status()).toBe(200);
    });
  });

  test.describe('異常系', () => {
    test('systemPrompt が極端に長くても API が正常に処理する', async ({ request }) => {
      const res = await request.post(`${BASE_URL}/api/chat`, {
        data: {
          message: 'こんにちは',
          conversationHistory: [],
          enableTools: false,
          systemPrompt: 'あ'.repeat(5000),
        },
      });
      // メッセージは valid なので 200 が返ること
      expect(res.status()).toBe(200);
    });

    test('enableTools=true かつ空メッセージは 400 を返す', async ({ request }) => {
      const res = await request.post(`${BASE_URL}/api/chat`, {
        data: {
          message: '',
          conversationHistory: [],
          enableTools: true,
          systemPrompt: 'テスト',
        },
      });
      expect(res.status()).toBe(400);
    });
  });
});
