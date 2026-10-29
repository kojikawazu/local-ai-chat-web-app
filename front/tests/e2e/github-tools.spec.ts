import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  installFakeGh,
  readFakeGhCalls,
  setFakeGhRules,
} from '../integration/helpers/fake-gh';
import {
  E2E_FAKE_GH_DIR,
  E2E_FAKE_GH_RULES,
  E2E_GITHUB_REPO,
} from './helpers/github';
import { IS_LIGHT_MODEL } from './helpers/model';
import {
  cleanupAllConversations,
  sendMessage,
  waitForResponseComplete,
} from './helpers/test-data';

/**
 * GitHub のツール（#148 Phase C。`docs/17-github-tools.md`）の E2E。
 *
 * dev サーバーには `playwright.config.ts` が `GITHUB_REPOS`（架空のリポジトリ）と、偽の gh のフォルダを先頭に足した `PATH` を渡す。
 * 偽の gh は真の外部（GitHub）の境界の差し替えで、本物の GitHub には触れない（CI に gh の認証は無く、書き込みは跡が残るため）。
 * ツールの登録は軽量モデル・CI でも確かめる。モデルにツールを呼ばせるテストは、軽量モデルではスキップする。
 * 引数の検証・gh の引数の組み立て・承認の流れの契約は IT（chat-agent-github.test.ts）が担う。
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

test.describe('GitHub のツール', () => {
  test.beforeAll(async () => {
    await installFakeGh(E2E_FAKE_GH_DIR, E2E_FAKE_GH_RULES);
  });

  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
    await setFakeGhRules(E2E_FAKE_GH_DIR, E2E_FAKE_GH_RULES);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('GitHub の 5 つのツールが一覧に出る', async ({ request }) => {
      const res = await request.get('/api/tools');
      const names = (await res.json()).tools.map(
        (tool: { name: string }) => tool.name
      );
      expect(names).toEqual(
        expect.arrayContaining([
          'github_list',
          'github_view',
          'github_pr_diff',
          'github_comment',
          'github_create_pr',
        ])
      );
    });

    test('PR の一覧は承認なしで読み、件数が ✅ で出る', async ({ page }) => {
      test.skip(IS_LIGHT_MODEL, '軽量モデルはツール呼び出しが不安定なため');
      test.setTimeout(240000);

      await askAgent(
        page,
        `github_list で ${E2E_GITHUB_REPO} の open な PR の一覧を見せてください`
      );
      await waitForResponseComplete(page, 200000);

      await expect(approvalCard(page)).toBeHidden();
      await expect(
        page.locator('button', { hasText: 'PR 2 件' }).first()
      ).toContainText('✅');
    });
  });

  test.describe('準正常系', () => {
    test('コメントは承認カードにコメント先・本文・公開の知らせが出て、拒否すると送らない', async ({
      page,
    }) => {
      test.skip(IS_LIGHT_MODEL, '軽量モデルはツール呼び出しが不安定なため');
      test.setTimeout(240000);

      await askAgent(
        page,
        `github_comment で ${E2E_GITHUB_REPO} の issue #1 に「E2E のコメントです」とコメントしてください`
      );
      const card = approvalCard(page);
      await expect(card).toBeVisible({ timeout: 200000 });
      await expect(card).toContainText('GitHub にコメントします');
      await expect(card).toContainText(`${E2E_GITHUB_REPO}（公開）`);
      await expect(card).toContainText('issue #1 E2E の質問');
      await expect(card.getByLabel('送る本文')).toContainText(
        'E2E のコメントです'
      );
      await expect(card.getByRole('note')).toContainText('公開リポジトリです');
      // 結果の欄は ✅ ではなく承認待ち（#192）
      const pending = page.locator('button', { hasText: 'GitHub にコメント' });
      await expect(pending.first()).toContainText('承認待ち');

      await card.getByRole('button', { name: '拒否' }).click();
      await waitForResponseComplete(page, 200000);

      await expect(
        page.locator('button', { hasText: '拒否されました' }).first()
      ).toContainText('❌');
      const calls = await readFakeGhCalls(E2E_FAKE_GH_DIR);
      expect(calls.some((call) => call.args[1] === 'comment')).toBe(false);
    });
  });

  test.describe('異常系', () => {
    test('存在しない PR は、gh のエラーが ❌ で出る', async ({ page }) => {
      test.skip(IS_LIGHT_MODEL, '軽量モデルはツール呼び出しが不安定なため');
      test.setTimeout(240000);

      await askAgent(
        page,
        `github_view で ${E2E_GITHUB_REPO} の PR #999 の詳細を見せてください`
      );
      await waitForResponseComplete(page, 200000);

      await expect(
        page
          .locator('button', { hasText: 'Could not resolve to a PullRequest' })
          .first()
      ).toContainText('❌');
    });
  });
});
