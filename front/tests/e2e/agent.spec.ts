import { test, expect } from '@playwright/test';
import { cleanupAllConversations, sendMessage } from './helpers/test-data';

// エージェント設定のON/OFFを切り替えるヘルパー
async function openSettings(page: Parameters<typeof sendMessage>[0]) {
  // 設定ボタンはサイドバー下部の歯車アイコン
  const settingsButton = page.locator('button[aria-label="設定を開く"]');
  await settingsButton.click();
  await expect(page.getByRole('dialog', { name: '設定' })).toBeVisible({
    timeout: 5000,
  });
}

async function closeSettings(page: Parameters<typeof sendMessage>[0]) {
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog', { name: '設定' })).toBeHidden({
    timeout: 3000,
  });
}

async function enableAgentTools(page: Parameters<typeof sendMessage>[0]) {
  await openSettings(page);
  const toggle = page.getByRole('button', { name: /ツール使用を有効化/ });
  // 現在 OFF の場合のみクリック
  const isEnabled = await page
    .locator('[data-tools-enabled="true"]')
    .count()
    .then((c) => c > 0)
    .catch(() => false);
  if (!isEnabled) {
    await toggle.click();
  }
  await closeSettings(page);
}

test.describe('エージェント機能', () => {
  test.setTimeout(180000);

  test.beforeAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('設定モーダルにAgent Toolsセクションが表示される', async ({ page }) => {
      await page.goto('/');
      await openSettings(page);

      await expect(page.getByText('Agent Tools')).toBeVisible();
      await expect(page.getByText('ツール使用を有効化')).toBeVisible();

      await closeSettings(page);
    });

    test('Agent Toolsトグルで有効化・無効化できる', async ({ page }) => {
      await page.goto('/');
      await openSettings(page);

      const toggle = page.getByRole('button', { name: /ツール使用を有効化/ });
      await expect(toggle).toBeVisible();

      // 1回クリックして状態が変化することを確認
      const beforeClass = await toggle.getAttribute('class');
      await toggle.click();
      const afterClass = await toggle.getAttribute('class');
      expect(beforeClass).not.toBe(afterClass);

      // 元に戻す
      await toggle.click();

      await closeSettings(page);
    });

    test('Agent Tools設定がlocalStorageに保存される', async ({ page }) => {
      await page.goto('/');
      await openSettings(page);

      const toggle = page.getByRole('button', { name: /ツール使用を有効化/ });
      // ONにする
      await toggle.click();
      await closeSettings(page);

      const stored = await page.evaluate(() =>
        localStorage.getItem('agent-tools-enabled')
      );
      expect(stored).toBe('true');

      // OFFに戻す
      await openSettings(page);
      await toggle.click();
      await closeSettings(page);

      const storedOff = await page.evaluate(() =>
        localStorage.getItem('agent-tools-enabled')
      );
      expect(storedOff).toBe('false');
    });

    test('ページリロード後もAgent Tools設定が保持される', async ({ page }) => {
      await page.goto('/');
      // localStorage に直接 true をセット
      await page.evaluate(() =>
        localStorage.setItem('agent-tools-enabled', 'true')
      );
      await page.reload();

      // 設定モーダルを開いてトグルがON状態であることを確認
      await openSettings(page);
      const toggle = page.getByRole('button', { name: /ツール使用を有効化/ });
      // ONのときは nord-frost-1 の背景クラスが付く
      await expect(toggle).toHaveClass(/nord-frost-1/);

      // クリーンアップ
      await toggle.click();
      await closeSettings(page);
    });

    test('GET /api/tools がツール一覧を返す', async ({ request }) => {
      const res = await request.get('http://localhost:3000/api/tools');
      expect(res.status()).toBe(200);

      const data = await res.json();
      expect(data).toHaveProperty('tools');
      expect(Array.isArray(data.tools)).toBe(true);
      expect(data.tools.length).toBeGreaterThan(0);

      const toolNames = data.tools.map((t: { name: string }) => t.name);
      expect(toolNames).toContain('get_current_datetime');
      expect(toolNames).toContain('calculate');
    });

    test('エージェントモードでメッセージを送信するとAI応答が返る', async ({
      page,
    }) => {
      test.skip(
        !!process.env.CI,
        'CI環境ではエージェントのツール呼び出しがモデルに依存するためスキップ'
      );

      await page.goto('/');
      await enableAgentTools(page);

      await sendMessage(page, '今の日時を教えてください');

      // ユーザーメッセージ表示を確認
      await expect(
        page.getByText('今の日時を教えてください').first()
      ).toBeVisible({ timeout: 10000 });

      // AI応答バブルが表示される
      const aiMessage = page.locator('[class*="bg-nord-2"]').first();
      await expect(aiMessage).toBeVisible({ timeout: 120000 });
    });

    test('エージェントモードでツール呼び出し完了後に結果が表示される', async ({
      page,
    }) => {
      test.skip(
        !!process.env.CI,
        'CI環境ではエージェントのツール呼び出しがモデルに依存するためスキップ'
      );

      await page.goto('/');
      await enableAgentTools(page);

      await sendMessage(page, '今の日時を教えてください');

      // 送信完了まで待機（ボタンが再度有効化）
      const sendButton = page.locator('button[type="submit"]');
      await expect(sendButton).toBeEnabled({ timeout: 120000 });

      // ツール呼び出し完了インジケーター（✅）が表示される
      const toolResult = page.locator('text=✅').first();
      await expect(toolResult).toBeVisible({ timeout: 5000 });
    });

    test('ツール呼び出し結果は折りたたみ/展開できる', async ({ page }) => {
      test.skip(
        !!process.env.CI,
        'CI環境ではエージェントのツール呼び出しがモデルに依存するためスキップ'
      );

      await page.goto('/');
      await enableAgentTools(page);

      await sendMessage(page, '今の日時を教えてください');

      // 送信完了まで待機
      const sendButton = page.locator('button[type="submit"]');
      await expect(sendButton).toBeEnabled({ timeout: 120000 });

      // ✅ ボタンをクリックして展開
      const toolResultButton = page
        .locator('button', { hasText: '✅' })
        .first();
      await expect(toolResultButton).toBeVisible({ timeout: 5000 });
      await toolResultButton.click();

      // 展開後に「結果」ラベルが表示される
      await expect(page.getByText('結果').first()).toBeVisible({
        timeout: 3000,
      });

      // 再クリックで折りたたむ
      await toolResultButton.click();
      await expect(page.getByText('結果').first()).toBeHidden({
        timeout: 3000,
      });
    });
  });

  test.describe('準正常系', () => {
    test('エージェントモードOFFでは通常チャットとして動作する', async ({
      page,
    }) => {
      await page.goto('/');
      // localStorage をクリアして Tools OFF 状態を確認
      await page.evaluate(() =>
        localStorage.setItem('agent-tools-enabled', 'false')
      );
      await page.reload();

      await openSettings(page);
      const toggle = page.getByRole('button', { name: /ツール使用を有効化/ });
      // OFFのときは nord-frost-1 クラスが付かない
      const cls = await toggle.getAttribute('class');
      expect(cls).not.toMatch(/nord-frost-1/);
      await closeSettings(page);
    });

    test('GET /api/tools のツールに enabled フィールドがある', async ({
      request,
    }) => {
      const res = await request.get('http://localhost:3000/api/tools');
      const data = await res.json();

      for (const tool of data.tools as { name: string; description: string; enabled: boolean }[]) {
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(typeof tool.enabled).toBe('boolean');
      }
    });
  });

  test.describe('異常系', () => {
    test('POST /api/chat に enableTools=true で不正なメッセージを送ると400を返す', async ({
      request,
    }) => {
      const res = await request.post('http://localhost:3000/api/chat', {
        data: {
          message: '',
          conversationHistory: [],
          model: 'qwen3-coder:latest',
          enableTools: true,
        },
      });
      expect(res.status()).toBe(400);
    });

    test('POST /api/chat に enableTools=true で10001文字のメッセージを送ると400を返す', async ({
      request,
    }) => {
      const res = await request.post('http://localhost:3000/api/chat', {
        data: {
          message: 'あ'.repeat(10001),
          conversationHistory: [],
          model: 'qwen3-coder:latest',
          enableTools: true,
        },
      });
      expect(res.status()).toBe(400);
    });
  });
});
