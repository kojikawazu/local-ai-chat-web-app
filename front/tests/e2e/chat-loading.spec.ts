import type { Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { cleanupAllConversations, sendMessage } from './helpers/test-data';

/** ローディング表示が初めて DOM に現れた瞬間の様子。 */
type LoadingSnapshot = {
  /** その瞬間に表示されていたコピーボタンの数 */
  copyButtons: number;
};

/**
 * ローディング表示（`aria-label="応答を生成中"`）が DOM に現れるのを監視し始める。**送信前に呼ぶ**。
 *
 * 軽量モデル（E2E 既定の `qwen2.5:0.5b`）は応答が速く、ローディング表示が数十 ms で消えることがある。
 * 送信後に待ち始めると既に消えており、`locator.waitFor` のポーリング（数十〜100ms 間隔）でも取りこぼすため、
 * MutationObserver で DOM の変化を漏れなく捕まえる。
 * `page.evaluate` は後続の操作（入力・送信）より先にページ内で実行されるため、監視は送信前に始まる。
 *
 * @param page - 監視対象のページ
 * @returns 表示が現れた瞬間の様子で解決する Promise。10 秒以内に現れなければ reject する
 */
function watchLoadingIndicator(page: Page): Promise<LoadingSnapshot> {
  return page.evaluate(
    () =>
      new Promise<LoadingSnapshot>((resolve, reject) => {
        const check = () => {
          if (!document.querySelector('[aria-label="応答を生成中"]')) return;
          observer.disconnect();
          clearTimeout(timer);
          resolve({
            copyButtons: document.querySelectorAll(
              'button[aria-label="コピー"]'
            ).length,
          });
        };
        const observer = new MutationObserver(check);
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
        });
        const timer = setTimeout(() => {
          observer.disconnect();
          reject(new Error('ローディング表示が 10 秒以内に現れませんでした'));
        }, 10000);
        check();
      })
  );
}

test.describe('ローディングアニメーション', () => {
  test.setTimeout(120000);

  test.beforeAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('メッセージ送信後にローディングアニメーションが表示される', async ({
      page,
    }) => {
      await page.goto('/');

      // ローディングアニメーション（ドットバウンス）が表示されることを確認
      const appeared = watchLoadingIndicator(page);
      await sendMessage(page, 'こんにちは');
      await appeared;
    });

    test('AI応答完了後にローディングアニメーションが消える', async ({
      page,
    }) => {
      await page.goto('/');

      // アニメーションが一時的に表示される
      const appeared = watchLoadingIndicator(page);
      await sendMessage(page, 'はい');
      await appeared;

      // 応答完了後にアニメーションが消え、AI応答テキストが表示される
      await expect(page.getByLabel('応答を生成中')).not.toBeVisible({
        timeout: 90000,
      });
      const aiMessages = page.locator('[class*="bg-nord-2"]');
      await expect(aiMessages.first()).toBeVisible();
    });
  });

  test.describe('準正常系', () => {
    test('ローディング中はコピーボタンが表示されない', async ({ page }) => {
      await page.goto('/');

      // ローディング中はコピーボタンが表示されない（isThisWaiting=true の場合に非表示）。
      // 応答が速いと、ローディングを確認してからコピーボタンを調べる間に応答が完了し得るため、
      // ローディング表示が現れた瞬間のコピーボタン数で判定する。
      // 新規会話で始めるため、この時点のコピーボタンは生成中の応答のものしか無い
      const appeared = watchLoadingIndicator(page);
      await sendMessage(page, 'テスト');
      expect(await appeared).toEqual({ copyButtons: 0 });
    });
  });

  test.describe('異常系', () => {
    test('ウェルカム画面ではローディングアニメーションが表示されない', async ({
      request,
      page,
    }) => {
      await cleanupAllConversations(request);
      await page.goto('/');

      // 会話がない状態ではウェルカム画面が表示され、アニメーションは表示されない
      await expect(page.getByText('Nordic Chat へようこそ')).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByLabel('応答を生成中')).not.toBeVisible();
    });
  });
});
