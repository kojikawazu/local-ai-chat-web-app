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

/** サイドバーの表示状態の保存先（`useSidebarVisibility` の localStorage キー） */
const SIDEBAR_STORAGE_KEY = 'nordic-chat-sidebar';
/** デスクトップのサイドバーの幅（px。`w-72`） */
const SIDEBAR_WIDTH = 288;
/** モバイルの画面の大きさ（mobile-navigation.spec.ts と同じ） */
const MOBILE = { width: 375, height: 667 };

/**
 * ヘッダーのサイドバーの切り替えボタンを返す。
 *
 * @param page - 対象のページ
 * @returns 切り替えボタンのロケーター
 */
function sidebarToggle(page: Page) {
  return page.getByRole('button', { name: 'サイドバー', exact: true });
}

/**
 * アプリのヘッダーを返す。`<header>` は `<main>` の中にあり `banner` のランドマークにならないため、要素で引く。
 *
 * @param page - 対象のページ
 * @returns ヘッダーのロケーター
 */
function appHeader(page: Page) {
  return page.locator('header');
}

/**
 * デスクトップのサイドバー（`aside`）の表示上の幅を返す。
 *
 * @param page - 対象のページ
 * @returns 幅（px）。要素が無ければ `null`
 */
async function sidebarWidth(page: Page) {
  return (await page.locator('aside').boundingBox())?.width ?? null;
}

test.describe('サイドバーの表示の切り替え（#24）', () => {
  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('隠すとサイドバーが消えて本文が広がり、ヘッダーの「新しい会話」「設定を開く」が使える', async ({
      page,
      request,
    }) => {
      const conv = await createConversation(request, '切り替えの会話');
      await createMessage(request, conv.id, 'user', '切り替えのメッセージ');
      await page.goto('/');
      await page.getByText('切り替えの会話').click();
      await expect(page.getByText('切り替えのメッセージ')).toBeVisible();

      const toggle = sidebarToggle(page);
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      // 表示中はヘッダーに「新しい会話」を出さない（サイドバーのボタンと 2 か所に並べない）
      await expect(
        appHeader(page).getByRole('button', { name: '新しい会話' })
      ).toHaveCount(0);
      const mainBefore = (await page.locator('main').boundingBox())?.width ?? 0;

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect.poll(() => sidebarWidth(page)).toBe(0);
      expect((await page.locator('main').boundingBox())?.width).toBeCloseTo(
        mainBefore + SIDEBAR_WIDTH,
        0
      );
      // 隠したサイドバーの中身は inert で、操作・読み上げの対象から外れる
      await expect(page.locator('aside')).toHaveJSProperty('inert', true);

      const header = appHeader(page);
      await header.getByRole('button', { name: '設定を開く' }).click();
      const settings = page.getByRole('dialog', { name: '設定' });
      await expect(settings).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(settings).toBeHidden();

      await header.getByRole('button', { name: '新しい会話' }).click();
      await expect(page.getByText('Nordic Chat へようこそ')).toBeVisible();
      // 新しい会話のモードの間は、サイドバーのボタンと同じく押せない
      await expect(
        header.getByRole('button', { name: '新しい会話' })
      ).toBeDisabled();
    });

    test('もう一度押すとサイドバーが戻り、ヘッダーの追加のボタンは消える', async ({
      page,
    }) => {
      await page.goto('/');
      const toggle = sidebarToggle(page);
      await toggle.click();
      await expect.poll(() => sidebarWidth(page)).toBe(0);

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect.poll(() => sidebarWidth(page)).toBe(SIDEBAR_WIDTH);
      await expect(page.locator('aside')).toHaveJSProperty('inert', false);
      await expect(
        appHeader(page).getByRole('button', { name: '設定を開く' })
      ).toHaveCount(0);
    });

    test('隠した状態は保存され、開き直しても隠れたまま', async ({ page }) => {
      await page.goto('/');
      await sidebarToggle(page).click();
      await expect.poll(() => sidebarWidth(page)).toBe(0);
      expect(
        await page.evaluate(
          (key) => localStorage.getItem(key),
          SIDEBAR_STORAGE_KEY
        )
      ).toBe('closed');

      await page.reload();
      await expect(sidebarToggle(page)).toHaveAttribute(
        'aria-expanded',
        'false'
      );
      await expect.poll(() => sidebarWidth(page)).toBe(0);
    });
  });

  test.describe('準正常系', () => {
    test('保存値が不正なら、サイドバーを表示して始める', async ({ page }) => {
      await page.addInitScript(
        (key) => localStorage.setItem(key, 'hidden'),
        SIDEBAR_STORAGE_KEY
      );
      await page.goto('/');
      await expect(sidebarToggle(page)).toHaveAttribute(
        'aria-expanded',
        'true'
      );
      await expect.poll(() => sidebarWidth(page)).toBe(SIDEBAR_WIDTH);
    });

    test('モバイルでは切り替えボタンを出さず、隠した状態を保存していてもドロワーで会話を選べる', async ({
      page,
      request,
    }) => {
      await createConversation(request, 'モバイルの会話');
      await page.addInitScript(
        (key) => localStorage.setItem(key, 'closed'),
        SIDEBAR_STORAGE_KEY
      );
      await page.setViewportSize(MOBILE);
      await page.goto('/');

      await expect(sidebarToggle(page)).toBeHidden();
      await page.getByRole('button', { name: 'メニューを開く' }).click();
      await expect(
        page.getByRole('dialog').getByText('モバイルの会話')
      ).toBeVisible();
    });
  });

  test.describe('異常系', () => {
    test('localStorage が例外を投げても、表示で始まり切り替えられる', async ({
      page,
    }) => {
      // ブラウザ API の境界の障害注入: ストレージが使えない環境（読み書きで例外）を再現する
      await page.addInitScript((key) => {
        const getItem = Storage.prototype.getItem;
        const setItem = Storage.prototype.setItem;
        Storage.prototype.getItem = function (name: string) {
          if (name === key) throw new Error('storage disabled');
          return getItem.call(this, name);
        };
        Storage.prototype.setItem = function (name: string, value: string) {
          if (name === key) throw new Error('storage disabled');
          setItem.call(this, name, value);
        };
      }, SIDEBAR_STORAGE_KEY);
      await page.goto('/');

      const toggle = sidebarToggle(page);
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect.poll(() => sidebarWidth(page)).toBe(0);
      await expect(page.getByText('Nordic Chat へようこそ')).toBeVisible();
    });
  });
});
