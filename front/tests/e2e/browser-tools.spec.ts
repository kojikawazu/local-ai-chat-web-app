import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  E2E_BROWSER_FIXTURE_ORIGIN,
  E2E_BROWSER_PASSPHRASE,
} from './helpers/browser';
import { IS_LIGHT_MODEL } from './helpers/model';
import {
  cleanupAllConversations,
  sendMessage,
  waitForResponseComplete,
} from './helpers/test-data';

/**
 * ブラウザのツール（#149。`docs/18-browser-tools.md`）の E2E。
 *
 * dev サーバーには `playwright.config.ts` が `BROWSER_ENABLED` と、確認用のページを配るサーバー（127.0.0.1:3101）を
 * `BROWSER_LOCAL_ORIGINS` として渡す。確認用のページは合言葉を JavaScript で描くため、ブラウザで開かないと読めない。
 * 押すと回数が増える「数える」ボタンを、操作のツール（#149 Phase C）で押させ、承認カードを確かめる。
 * 公開の Web には触れない。ツールの登録は軽量モデル・CI でも確かめる。モデルにツールを呼ばせるテストは、軽量モデルではスキップする。
 * 宛先の判定（転送・ページの中のリクエスト・アプリ自身）と画像の渡し方の契約は IT（chat-agent-browser.test.ts）、
 * 操作の準備・承認・照合の契約は IT（chat-agent-browser-actions.test.ts）が担う。
 */

/**
 * エージェントモードで送信する。
 *
 * @param page - 対象のページ
 * @param text - 送る文章
 */
async function askAgent(page: Page, text: string) {
  await page.addInitScript(() =>
    localStorage.setItem('agent-tools-enabled', 'true')
  );
  await page.goto('/');
  await sendMessage(page, text);
}

/**
 * 承認カード。
 *
 * @param page - 対象のページ
 * @returns 承認カードのロケーター
 */
function approvalCard(page: Page) {
  return page.getByRole('region', { name: 'ツールの実行の承認' });
}

/** 確認用のページを開いて「数える」ボタンを押させる依頼 */
const CLICK_REQUEST = `browser_navigate で ${E2E_BROWSER_FIXTURE_ORIGIN}/ を開き、「数える」ボタンを browser_click で 1 回押して、押した後の回数を教えてください`;

test.describe('ブラウザのツール', () => {
  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('ブラウザの 6 つのツールが一覧に出る', async ({ request }) => {
      const res = await request.get('/api/tools');
      const names = (await res.json()).tools.map(
        (tool: { name: string }) => tool.name
      );
      expect(names).toEqual(
        expect.arrayContaining([
          'browser_navigate',
          'browser_snapshot',
          'browser_screenshot',
          'browser_click',
          'browser_type',
          'browser_select',
        ])
      );
    });

    test('ボタンを押す前に承認カードに要素が出て、許可すると押した後の回数を答える', async ({
      page,
    }) => {
      test.skip(IS_LIGHT_MODEL, '軽量モデルはツール呼び出しが不安定なため');
      test.setTimeout(300000);

      await askAgent(page, CLICK_REQUEST);
      const card = approvalCard(page);
      await expect(card).toBeVisible({ timeout: 240000 });
      await expect(card).toContainText('ブラウザでクリックします');
      await expect(card).toContainText('手元の開発サーバー');
      // モデルの説明ではなく、参照から引いた実際の要素を出す
      await expect(card.getByLabel('操作する要素')).toHaveText(
        'button "数える"'
      );

      await card.getByRole('button', { name: '許可' }).click();
      await waitForResponseComplete(page, 240000);

      await expect(
        page.locator('button', { hasText: 'button "数える"' }).first()
      ).toContainText('✅');
      await expect(page.locator('.prose-nord').last()).toContainText('1');
    });

    test('手元の開発サーバーのページを開き、JavaScript で描いた合言葉を答える', async ({
      page,
    }) => {
      test.skip(IS_LIGHT_MODEL, '軽量モデルはツール呼び出しが不安定なため');
      test.setTimeout(240000);

      await askAgent(
        page,
        `browser_navigate で ${E2E_BROWSER_FIXTURE_ORIGIN}/ を開き、ページに書かれた合言葉を教えてください`
      );
      await waitForResponseComplete(page, 200000);

      await expect(
        page.locator('button', { hasText: 'E2E の確認用のページ' }).first()
      ).toContainText('✅');
      await expect(page.locator('.prose-nord').last()).toContainText(
        E2E_BROWSER_PASSPHRASE
      );
    });
  });

  test.describe('準正常系', () => {
    test('許可していない手元のサーバーは開かず、設定の仕方が ❌ で出る', async ({
      page,
    }) => {
      test.skip(IS_LIGHT_MODEL, '軽量モデルはツール呼び出しが不安定なため');
      test.setTimeout(240000);

      // 5499 は PostgreSQL（BROWSER_LOCAL_ORIGINS に無い）
      await askAgent(
        page,
        'browser_navigate で http://127.0.0.1:5499/ を開いてください'
      );
      await waitForResponseComplete(page, 200000);

      await expect(
        page.locator('button', { hasText: 'BROWSER_LOCAL_ORIGINS' }).first()
      ).toContainText('❌');
    });

    test('ボタンを押す前の承認カードで拒否すると、押さずに ❌ で出る', async ({
      page,
    }) => {
      test.skip(IS_LIGHT_MODEL, '軽量モデルはツール呼び出しが不安定なため');
      test.setTimeout(300000);

      await askAgent(page, CLICK_REQUEST);
      const card = approvalCard(page);
      await expect(card).toBeVisible({ timeout: 240000 });
      await card.getByRole('button', { name: '拒否' }).click();
      await waitForResponseComplete(page, 240000);

      await expect(
        page.locator('button', { hasText: '拒否されました' }).first()
      ).toContainText('❌');
    });
  });

  test.describe('異常系', () => {
    test('名前を引けないホストは開かず、❌ で出る', async ({ page }) => {
      test.skip(IS_LIGHT_MODEL, '軽量モデルはツール呼び出しが不安定なため');
      test.setTimeout(240000);

      // .invalid は名前を引けないことが決まっている（RFC 2606）。file: の URL はモデルが呼ぶのを断るため、
      // file: を止めることは IT（chat-agent-browser.test.ts）で確かめる
      await askAgent(
        page,
        'browser_navigate で http://nordic-e2e.invalid/ を開いてください'
      );
      await waitForResponseComplete(page, 200000);

      await expect(
        page.locator('button', { hasText: '解決できません' }).first()
      ).toContainText('❌');
    });
  });
});
