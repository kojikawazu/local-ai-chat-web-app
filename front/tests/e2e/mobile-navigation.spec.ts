import type { Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import {
  cleanupAllConversations,
  createConversation,
  createMessage,
  fetchConversations,
} from './helpers/test-data';

/**
 * モバイル幅のナビゲーション（ヘッダーのメニューボタン → サイドバードロワー）の E2E（#93）。
 *
 * md 未満ではデスクトップのサイドバーが隠れるため、会話の選択・新規会話・削除・設定の
 * 全操作がドロワーから到達できること、およびドロワーのキーボード／支援技術向けの
 * 開閉状態（aria 属性・フォーカス・Escape・背景スクロール）を検証する。
 * Ollama への通信を伴わない（会話データは API で投入する）。
 */
const MOBILE = { width: 375, height: 667 };

/**
 * ヘッダーのメニューボタン。
 *
 * @param page - 操作対象のページ
 * @returns メニューボタンのロケーター
 */
const menuButton = (page: Page) =>
  page.getByRole('button', { name: 'メニューを開く' });

/**
 * サイドバードロワー（モーダルダイアログ）。
 *
 * @param page - 操作対象のページ
 * @returns ドロワーのロケーター
 */
const drawer = (page: Page) => page.getByRole('dialog', { name: 'メニュー' });

/**
 * メニューボタンからドロワーを開き、表示されるまで待つ。
 *
 * @param page - 操作対象のページ
 */
async function openDrawer(page: Page) {
  await menuButton(page).click();
  await expect(drawer(page)).toBeVisible();
}

test.describe('モバイルナビゲーション（サイドバードロワー）', () => {
  test.beforeEach(async ({ page, request }) => {
    await cleanupAllConversations(request);
    await page.setViewportSize(MOBILE);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('375px 幅で履歴を開き、会話を切り替えられる', async ({
      page,
      request,
    }) => {
      const first = await createConversation(request, '一つ目の会話');
      await createMessage(request, first.id, 'user', '一つ目のメッセージ');
      const second = await createConversation(request, '二つ目の会話');
      await createMessage(request, second.id, 'user', '二つ目のメッセージ');

      await page.goto('/');
      // デスクトップのサイドバーは隠れ、メニューボタンが代わりの入口になる
      await expect(page.locator('aside')).toBeHidden();
      await expect(menuButton(page)).toBeVisible();

      await openDrawer(page);
      await drawer(page)
        .getByRole('button', { name: '一つ目の会話', exact: true })
        .click();
      // 選択するとドロワーが閉じ、その会話のメッセージが表示される
      await expect(drawer(page)).toBeHidden();
      await expect(page.getByText('一つ目のメッセージ')).toBeVisible();

      await openDrawer(page);
      // 選択中の会話が示される
      await expect(
        drawer(page).getByRole('button', { name: '一つ目の会話', exact: true })
      ).toHaveAttribute('aria-current', 'page');
      await drawer(page)
        .getByRole('button', { name: '二つ目の会話', exact: true })
        .click();
      await expect(page.getByText('二つ目のメッセージ')).toBeVisible();
      await expect(page.getByText('一つ目のメッセージ')).toHaveCount(0);
    });

    test('375px 幅で新規会話に移れる', async ({ page, request }) => {
      const conv = await createConversation(request, '既存の会話');
      await createMessage(request, conv.id, 'user', '既存のメッセージ');

      await page.goto('/');
      await openDrawer(page);
      await drawer(page)
        .getByRole('button', { name: '既存の会話', exact: true })
        .click();
      await expect(page.getByText('既存のメッセージ')).toBeVisible();

      await openDrawer(page);
      await drawer(page)
        .getByRole('button', { name: 'New Conversation' })
        .click();

      await expect(drawer(page)).toBeHidden();
      await expect(page.getByText('既存のメッセージ')).toHaveCount(0);
      // 新規会話ではすぐ入力できるよう入力欄へフォーカスが移る
      await expect(page.locator('textarea')).toBeFocused();
    });

    test('375px 幅で会話を削除でき、ドロワーは開いたまま続けて操作できる', async ({
      page,
      request,
    }) => {
      await createConversation(request, '削除する会話');
      await createConversation(request, '残す会話');

      await page.goto('/');
      await openDrawer(page);

      // hover の無いタッチ操作を想定し、hover せずに削除ボタンを押せること
      const deleteButton = drawer(page).getByRole('button', {
        name: '「削除する会話」を削除',
      });
      await expect(deleteButton).toBeVisible();
      await expect(deleteButton).toHaveCSS('opacity', '1');
      await deleteButton.click();

      await expect(
        drawer(page).getByRole('button', { name: '削除する会話', exact: true })
      ).toHaveCount(0);
      await expect(drawer(page)).toBeVisible();
      await expect(
        drawer(page).getByRole('button', { name: '残す会話', exact: true })
      ).toBeVisible();

      const titles = (await fetchConversations(request)).map((c) => c.title);
      expect(titles).not.toContain('削除する会話');
      expect(titles).toContain('残す会話');
    });

    test('375px 幅で設定を開き、テーマと Agent Tools を変更できる', async ({
      page,
    }) => {
      await page.goto('/');
      await page.evaluate(() => localStorage.clear());
      await page.reload();

      await openDrawer(page);
      await drawer(page).getByRole('button', { name: '設定を開く' }).click();

      const settings = page.getByRole('dialog', { name: '設定' });
      await expect(settings).toBeVisible();
      // 設定へ移るとドロワーは閉じ、設定モーダルと重ならない
      await expect(drawer(page)).toBeHidden();

      await settings.getByRole('button', { name: /Aurora Borealis/ }).click();
      await expect(page.locator('html')).toHaveAttribute(
        'data-theme',
        'aurora'
      );

      await settings
        .getByRole('button', { name: /ツール使用を有効化/ })
        .click();
      await expect
        .poll(() =>
          page.evaluate(() => localStorage.getItem('agent-tools-enabled'))
        )
        .toBe('true');
    });
  });

  test.describe('準正常系', () => {
    test('開閉状態を aria 属性で示し、Escape で閉じるとフォーカスがメニューボタンへ戻る', async ({
      page,
    }) => {
      await page.goto('/');
      await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(menuButton(page)).toHaveAttribute('aria-haspopup', 'dialog');

      // キーボードだけで開く
      await menuButton(page).focus();
      await page.keyboard.press('Enter');
      await expect(drawer(page)).toBeVisible();
      await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'true');
      await expect(drawer(page)).toHaveAttribute('aria-modal', 'true');
      // aria-controls がドロワーのパネルを指している
      const controls = await menuButton(page).getAttribute('aria-controls');
      expect(controls).toBeTruthy();
      await expect(drawer(page)).toHaveAttribute('id', controls!);
      // 開くとフォーカスがドロワー内へ移る
      await expect(
        drawer(page).getByRole('button', { name: 'メニューを閉じる' })
      ).toBeFocused();

      await page.keyboard.press('Escape');
      await expect(drawer(page)).toBeHidden();
      await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(menuButton(page)).toBeFocused();
    });

    test('Tab / Shift+Tab を繰り返してもフォーカスがドロワーの外へ出ない', async ({
      page,
      request,
    }) => {
      await createConversation(request, 'フォーカス確認用');
      await page.goto('/');
      await openDrawer(page);

      const isFocusInDrawer = () =>
        page.evaluate(() =>
          Boolean(
            document.activeElement?.closest(
              '[role="dialog"][aria-label="メニュー"]'
            )
          )
        );

      // ドロワー内の操作要素の数より多く押し、末尾から先頭へ循環させる
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press('Tab');
        expect(await isFocusInDrawer()).toBe(true);
      }
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press('Shift+Tab');
        expect(await isFocusInDrawer()).toBe(true);
      }
    });

    test('背景をクリックするとドロワーが閉じる', async ({ page }) => {
      await page.goto('/');
      await openDrawer(page);

      // パネル（幅 288px）の外側＝背景の右端をクリックする
      await page.mouse.click(MOBILE.width - 10, MOBILE.height / 2);
      await expect(drawer(page)).toBeHidden();
    });

    test('開いている間は背景のスクロールを止め、閉じると戻す', async ({
      page,
    }) => {
      await page.goto('/');
      const bodyOverflow = () =>
        page.evaluate(() => document.body.style.overflow);

      await openDrawer(page);
      expect(await bodyOverflow()).toBe('hidden');

      await drawer(page)
        .getByRole('button', { name: 'メニューを閉じる' })
        .click();
      await expect(drawer(page)).toBeHidden();
      await expect.poll(bodyOverflow).toBe('');
    });
  });

  test.describe('異常系', () => {
    test('320px 幅でもヘッダーとドロワーの操作がビューポート内に収まる', async ({
      page,
      request,
    }) => {
      await createConversation(
        request,
        'とても長いタイトルの会話がドロワーの幅を押し広げないことを確認する'
      );
      await page.setViewportSize({ width: 320, height: 568 });
      await page.goto('/');

      /**
       * 要素の左右端がビューポート（幅 320px）からはみ出していないことを確かめる。
       *
       * @param locator - 検証対象の要素
       */
      const expectWithinViewport = async (
        locator: ReturnType<Page['getByRole']>
      ) => {
        const box = await locator.boundingBox();
        expect(box).toBeTruthy();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(320);
      };

      await expectWithinViewport(menuButton(page));
      await expectWithinViewport(
        page.getByRole('combobox', { name: 'モデルを選択' })
      );

      await openDrawer(page);
      for (const name of [
        'メニューを閉じる',
        'New Conversation',
        '設定を開く',
        /を削除$/,
      ]) {
        await expectWithinViewport(drawer(page).getByRole('button', { name }));
      }
    });

    test('ドロワーを開いたままデスクトップ幅へ広げると閉じ、スクロールの固定も解除される', async ({
      page,
    }) => {
      await page.goto('/');
      await openDrawer(page);

      await page.setViewportSize({ width: 1280, height: 720 });

      await expect(drawer(page)).toBeHidden();
      await expect(page.locator('aside')).toBeVisible();
      await expect(menuButton(page)).toBeHidden();
      // 閉じた後の effect の cleanup で戻るため、反映を待って確かめる
      await expect
        .poll(() => page.evaluate(() => document.body.style.overflow))
        .toBe('');
    });

    test('会話が 0 件でもドロワーが開き、設定へ進める', async ({ page }) => {
      await page.goto('/');
      await openDrawer(page);

      // 新規会話モードのため New Conversation は無効、履歴は空
      await expect(
        drawer(page).getByRole('button', { name: 'New Conversation' })
      ).toBeDisabled();
      await expect(
        drawer(page).getByRole('button', { name: /を削除$/ })
      ).toHaveCount(0);

      await drawer(page).getByRole('button', { name: '設定を開く' }).click();
      await expect(page.getByRole('dialog', { name: '設定' })).toBeVisible();
    });
  });
});
