import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import {
  cleanupAllConversations,
  createConversation,
  createMessage,
} from './helpers/test-data';

/**
 * ショートカットキーの E2E（#33。`docs/23-keyboard-shortcuts.md`）。
 *
 * 会話は API で作る（Ollama を使わず、軽量モデル・CI でも動く）。キーの判定（修飾キーのちょうど一致・端末の表記・
 * 一覧の移る先）は UT（keyboard-shortcuts.test.ts）が担い、ここでは実際のブラウザでキーを押したときの画面の動き
 * （フォーカス・サイドバー・会話の切り替え・ヘルプ・モーダルの間は効かない）を見る。
 * ⌘ と Ctrl は、アプリが判定した端末に合わせて選ぶ（{@link modKey}）。
 * IME の変換中はブラウザで安定して起こせないため UT で見る。
 */

/**
 * 古い順に会話を 3 つ作る（サイドバーは新しい順なので、上から「会話 C・会話 B・会話 A」と並ぶ）。
 *
 * @param request - API のリクエストのコンテキスト
 */
async function createThreeConversations(request: APIRequestContext) {
  for (const title of ['会話 A', '会話 B', '会話 C']) {
    const conversation = await createConversation(request, title);
    // 更新日時の並びを確かめるため、作るたびにメッセージを 1 件足して更新日時を進める
    await createMessage(request, conversation.id, 'user', `${title}の質問`);
  }
}

/**
 * ページを開き、キーを受けられるまで待つ（通信が落ち着くまで＝React の準備と会話の一覧の読み込みが済むまで）。
 * 開いた直後に押すと、ページ全体のキーを受ける前・一覧が空のうちにキーが届き、何も起きない。
 *
 * @param page - 対象のページ
 */
async function openApp(page: Page) {
  await page.goto('/', { waitUntil: 'networkidle' });
}

/**
 * アプリが「Mac では ⌘、それ以外では Ctrl」と判定するときの修飾キーを、ページの中の判定と同じ方法で決める。
 *
 * Playwright の `ControlOrMeta` は実際に動いている OS（Mac なら ⌘）で決まるが、設定の `devices['Desktop Chrome']` は
 * User-Agent を Windows の Chrome にするため、Mac で動かすとアプリは Ctrl を待つ。アプリの判定（`useIsMac` の
 * `isMacPlatform`）と同じ値から選び、どちらの OS で動かしても食い違わないようにする。
 *
 * @param page - 対象のページ
 * @returns `Meta`（アプリが Mac と判定）か `Control`
 */
async function modKey(page: Page): Promise<'Meta' | 'Control'> {
  const isMac = await page.evaluate(() => {
    // userAgentData は TypeScript の DOM の型にまだ無いため、使う部分だけを足した形として読む
    const nav = navigator as Navigator & {
      userAgentData?: { platform?: string };
    };
    return /mac|iphone|ipad|ipod/i.test(
      nav.userAgentData?.platform || nav.platform || ''
    );
  });
  return isMac ? 'Meta' : 'Control';
}

/**
 * デスクトップのサイドバーの会話の行（行のボタン）。
 *
 * @param page - 対象のページ
 * @param title - 会話のタイトル
 * @returns 行のボタンのロケーター
 */
function row(page: Page, title: string) {
  return page
    .locator('aside')
    .getByRole('button', { name: title, exact: true });
}

/**
 * 開いている会話のタイトル（サイドバーで `aria-current="page"` の行）。
 *
 * @param page - 対象のページ
 * @returns 選ばれている行のロケーター
 */
function currentRow(page: Page) {
  return page.locator('aside [aria-current="page"]');
}

test.describe('ショートカットキー', () => {
  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('⌘⇧O（Ctrl+Shift+O）で新しい会話になり、入力欄にフォーカスする', async ({
      page,
      request,
    }) => {
      await createThreeConversations(request);
      await openApp(page);
      const mod = await modKey(page);
      await row(page, '会話 B').click();
      await expect(row(page, '会話 B')).toHaveAttribute('aria-current', 'page');

      await page.keyboard.press(`${mod}+Shift+O`);

      await expect(currentRow(page)).toHaveCount(0);
      await expect(
        page.locator('aside').getByRole('button', { name: 'New Conversation' })
      ).toBeDisabled();
      await expect(page.locator('textarea')).toBeFocused();
    });

    test('⌘K で検索欄、Shift+Esc で入力欄にフォーカスする（入力欄の中でも効く）', async ({
      page,
    }) => {
      await openApp(page);
      const mod = await modKey(page);
      const textarea = page.locator('textarea');
      await textarea.click();
      await textarea.pressSequentially('書きかけ', { delay: 10 });

      await page.keyboard.press(`${mod}+K`);
      const search = page.locator('aside').getByRole('textbox', {
        name: '会話を検索',
      });
      await expect(search).toBeFocused();

      await page.keyboard.press('Shift+Escape');
      await expect(textarea).toBeFocused();
      // 入力欄の書きかけは残る
      await expect(textarea).toHaveValue('書きかけ');
    });

    test('⌘B でサイドバーを閉じ、閉じている間の ⌘K で開いて検索欄にフォーカスする', async ({
      page,
    }) => {
      await openApp(page);
      const mod = await modKey(page);
      const toggle = page.getByRole('button', { name: 'サイドバー' });
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');

      await page.keyboard.press(`${mod}+B`);
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');

      await page.keyboard.press(`${mod}+K`);
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(
        page.locator('aside').getByRole('textbox', { name: '会話を検索' })
      ).toBeFocused();
    });

    test('Ctrl+Shift+↓↑ でサイドバーの並びの次・前の会話へ移り、端で止まる', async ({
      page,
      request,
    }) => {
      await createThreeConversations(request);
      await openApp(page);

      await expect(row(page, '会話 A')).toBeVisible();
      // 新しい会話のモードからの ↓ は一番上の会話
      await page.keyboard.press('Control+Shift+ArrowDown');
      await expect(row(page, '会話 C')).toHaveAttribute('aria-current', 'page');
      await page.keyboard.press('Control+Shift+ArrowDown');
      await expect(row(page, '会話 B')).toHaveAttribute('aria-current', 'page');
      await page.keyboard.press('Control+Shift+ArrowUp');
      await expect(row(page, '会話 C')).toHaveAttribute('aria-current', 'page');
      // 一番上で ↑ を押しても回らない
      await page.keyboard.press('Control+Shift+ArrowUp');
      await expect(row(page, '会話 C')).toHaveAttribute('aria-current', 'page');
    });

    test('⌘/ と、入力欄の外の ? でショートカットの一覧を開く', async ({
      page,
    }) => {
      await openApp(page);
      const mod = await modKey(page);
      const dialog = page.getByRole('dialog', {
        name: 'キーボードショートカット',
      });

      await page.locator('textarea').click();
      await page.keyboard.press(`${mod}+/`);
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole('rowheader', { name: '会話を検索' })
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();

      // 入力欄の外（ページの本文）で ?
      await page.locator('main').click({ position: { x: 400, y: 300 } });
      await page.keyboard.press('Shift+?');
      await expect(dialog).toBeVisible();
    });

    test('設定モーダルの「一覧」からショートカットの一覧を開く', async ({
      page,
    }) => {
      await openApp(page);
      await page
        .locator('aside')
        .getByRole('button', { name: '設定を開く' })
        .click();
      const settings = page.getByRole('dialog', { name: '設定' });
      await settings.getByRole('button', { name: '一覧' }).click();

      await expect(settings).toBeHidden();
      await expect(
        page.getByRole('dialog', { name: 'キーボードショートカット' })
      ).toBeVisible();
    });

    test('サイドバーの会話の行で ↑↓・Home・End を押すと行を移る（会話は開かない）', async ({
      page,
      request,
    }) => {
      await createThreeConversations(request);
      await openApp(page);
      await row(page, '会話 C').focus();

      await page.keyboard.press('ArrowDown');
      await expect(row(page, '会話 B')).toBeFocused();
      await page.keyboard.press('End');
      await expect(row(page, '会話 A')).toBeFocused();
      await page.keyboard.press('Home');
      await expect(row(page, '会話 C')).toBeFocused();
      // フォーカスを移すだけで、会話は開かない
      await expect(currentRow(page)).toHaveCount(0);

      await page.keyboard.press('Enter');
      await expect(row(page, '会話 C')).toHaveAttribute('aria-current', 'page');
    });
  });

  test.describe('準正常系', () => {
    test('入力欄の中の ? は文字として入る（一覧を開かない）', async ({
      page,
    }) => {
      await openApp(page);
      const textarea = page.locator('textarea');
      await textarea.click();
      await textarea.pressSequentially('なぜ?', { delay: 10 });

      await expect(textarea).toHaveValue('なぜ?');
      await expect(
        page.getByRole('dialog', { name: 'キーボードショートカット' })
      ).toHaveCount(0);
    });

    test('一覧の一番上の行で ↑ を押しても動かない', async ({
      page,
      request,
    }) => {
      await createThreeConversations(request);
      await openApp(page);
      await row(page, '会話 C').focus();

      await page.keyboard.press('ArrowUp');
      await expect(row(page, '会話 C')).toBeFocused();
    });
  });

  test.describe('異常系', () => {
    test('モーダルが開いている間はショートカットが効かない', async ({
      page,
      request,
    }) => {
      await createThreeConversations(request);
      await openApp(page);
      const mod = await modKey(page);
      await row(page, '会話 B').click();
      await page
        .locator('aside')
        .getByRole('button', { name: '設定を開く' })
        .click();
      const settings = page.getByRole('dialog', { name: '設定' });
      await expect(settings).toBeVisible();

      await page.keyboard.press('Control+Shift+ArrowDown');
      await page.keyboard.press(`${mod}+Shift+O`);

      await expect(settings).toBeVisible();
      await expect(row(page, '会話 B')).toHaveAttribute('aria-current', 'page');
    });
  });
});
