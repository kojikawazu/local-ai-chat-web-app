import type { Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import {
  cleanupAllConversations,
  createConversation,
  createMessage,
} from './helpers/test-data';

/**
 * サイドバーの会話検索の E2E（#11）。
 *
 * 会話は API で用意する（モデルの応答に依存せず、軽量モデル・CI でも動く）。検索の条件
 * （AND・大文字と小文字・`%` の扱い・ページ分け）の契約は IT（conversations-search.test.ts）、
 * 抜粋・強調の分割は UT（search.test.ts）が担い、ここでは画面の操作と表示を見る。
 */

/**
 * デスクトップのサイドバーの検索欄。
 *
 * @param page - 対象のページ
 * @returns 検索欄のロケーター
 */
function searchBox(page: Page) {
  return page.locator('aside').getByLabel('会話を検索');
}

/**
 * デスクトップのサイドバーの検索結果。
 *
 * @param page - 対象のページ
 * @returns 検索結果の領域のロケーター
 */
function results(page: Page) {
  return page.locator('aside').getByRole('region', { name: '検索結果' });
}

/**
 * 検索欄にキーワードを入力する。
 *
 * React の制御された入力は `fill()` では state が更新されないことがあるため、1 文字ずつ打つ
 * （`helpers/test-data.ts` の `fillTextarea` と同じ理由）。
 *
 * @param page - 対象のページ
 * @param keyword - 入力するキーワード
 */
async function typeKeyword(page: Page, keyword: string) {
  await searchBox(page).click();
  await searchBox(page).pressSequentially(keyword, { delay: 10 });
}

test.describe('会話検索', () => {
  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('本文のキーワードで会話が見つかり、抜粋の一致箇所が強調され、押すとその会話が開く', async ({
      page,
      request,
    }) => {
      const conv = await createConversation(request, '型の相談');
      await createMessage(request, conv.id, 'user', '型ガードの書き方は？');
      await createMessage(
        request,
        conv.id,
        'assistant',
        'TypeScript の型ガードは、typeof や in で型を絞り込みます。'
      );
      await createConversation(request, '関係のない会話');
      await page.goto('/');

      await typeKeyword(page, 'typescript');

      const found = results(page).getByRole('button', { name: /型の相談/ });
      await expect(found).toBeVisible();
      await expect(found.locator('mark')).toHaveText('TypeScript');
      await expect(results(page).getByText('関係のない会話')).toHaveCount(0);

      await found.click();

      await expect(
        page.locator('main').getByText('型ガードの書き方は？')
      ).toBeVisible();
      await expect(found).toHaveAttribute('aria-current', 'page');
    });

    test('空白で区切った語をすべて含む会話だけが見つかる', async ({
      page,
      request,
    }) => {
      const both = await createConversation(request, 'React の相談');
      await createMessage(request, both.id, 'user', 'フックの使い方');
      await createConversation(request, 'React の別の相談');
      await page.goto('/');

      await typeKeyword(page, 'React フック');

      await expect(
        results(page).getByRole('button', { name: /React の相談/ })
      ).toBeVisible();
      await expect(results(page).getByText('React の別の相談')).toHaveCount(0);
    });
  });

  test.describe('準正常系', () => {
    test('一致する会話が無ければその旨を表示し、× で履歴一覧に戻る', async ({
      page,
      request,
    }) => {
      await createConversation(request, '雑談');
      await page.goto('/');

      await typeKeyword(page, '存在しない語');

      await expect(
        results(page).getByText('一致する会話は見つかりませんでした')
      ).toBeVisible();

      await page
        .locator('aside')
        .getByRole('button', { name: '検索をやめる' })
        .click();

      await expect(results(page)).toHaveCount(0);
      await expect(searchBox(page)).toHaveValue('');
      await expect(page.locator('aside').getByText('雑談')).toBeVisible();
    });

    test('Escape で検索をやめて履歴一覧に戻る', async ({ page, request }) => {
      await createConversation(request, 'Java の相談');
      await createConversation(request, '雑談');
      await page.goto('/');
      await typeKeyword(page, 'Java');
      await expect(
        results(page).getByRole('button', { name: /Java の相談/ })
      ).toBeVisible();

      await searchBox(page).press('Escape');

      await expect(results(page)).toHaveCount(0);
      await expect(page.locator('aside').getByText('雑談')).toBeVisible();
    });

    test('結果が多いときは「さらに表示」で続きを読める', async ({
      page,
      request,
    }) => {
      // 1 回に返す 20 件を超える数を用意する
      for (let i = 0; i < 22; i++) {
        await createConversation(request, `Java の相談 ${i}`);
      }
      await page.goto('/');

      await typeKeyword(page, 'Java');

      const items = results(page).getByRole('button', { name: /Java の相談/ });
      await expect(items).toHaveCount(20);

      await results(page).getByRole('button', { name: 'さらに表示' }).click();

      await expect(items).toHaveCount(22);
      await expect(
        results(page).getByRole('button', { name: 'さらに表示' })
      ).toHaveCount(0);
    });
  });

  test.describe('異常系', () => {
    test('検索に失敗したら理由を表示し、検索をやめれば履歴一覧を使い続けられる', async ({
      page,
      request,
    }) => {
      // DB を安定して壊せないため、検索 API の応答だけを失敗させる（境界の障害注入）
      await page.route('**/api/conversations/search**', (route) =>
        route.fulfill({
          status: 500,
          json: { error: '会話の検索に失敗しました' },
        })
      );
      await createConversation(request, '雑談');
      await page.goto('/');

      await typeKeyword(page, 'Java');

      await expect(
        results(page).getByText('会話の検索に失敗しました')
      ).toBeVisible();

      await searchBox(page).press('Escape');
      await page.locator('aside').getByText('雑談').click();
      await expect(
        page.locator('aside').getByRole('button', { name: '雑談', exact: true })
      ).toHaveAttribute('aria-current', 'page');
    });
  });
});
