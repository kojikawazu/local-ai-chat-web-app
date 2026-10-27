import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { access, rm } from 'fs/promises';
import path from 'path';
import { E2E_WRITE_DIR } from './helpers/local-files';
import { IS_LIGHT_MODEL } from './helpers/model';
import {
  cleanupAllConversations,
  sendMessage,
  waitForResponseComplete,
} from './helpers/test-data';

/**
 * コマンドの実行前の承認（#148 Phase B）の E2E。
 *
 * dev サーバーには `playwright.config.ts` が `LOCAL_COMMANDS=node` と、作業フォルダにできる OS の一時フォルダ（`E2E_WRITE_DIR`）を渡す。
 * ツールの登録は軽量モデル・CI でも確かめる。モデルにコマンドの実行を頼んで承認カードを操作するテストは
 * ツール呼び出しが要るため、軽量モデルではスキップする。
 * 承認の流れ（許可・拒否・停止）の契約は IT（chat-agent-command.test.ts）、コマンドの解釈・プロセスの停止は IT（local-command.test.ts）が担う。
 * 承認の API の 404・400 は file-write-approval.spec.ts が確かめる（同じ API のため繰り返さない）。
 */

const MARKER = path.join(E2E_WRITE_DIR, 'command-ran.txt');

/**
 * ファイルがあるかを確かめる。
 *
 * @param file - ファイルのパス
 * @returns あれば true
 */
async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false
  );
}

/**
 * エージェントモードで、ファイルを作るコマンドの実行を頼む。
 *
 * @param page - 対象のページ
 */
async function askToRun(page: Page) {
  await page.addInitScript(() =>
    localStorage.setItem('agent-tools-enabled', 'true')
  );
  await page.goto('/');
  await sendMessage(
    page,
    `run_command で、作業フォルダ ${E2E_WRITE_DIR} で次のコマンドを実行してください: node -e "require('fs').writeFileSync('command-ran.txt', 'ok')"`
  );
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

test.describe('コマンドの実行の承認', () => {
  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
    await rm(MARKER, { force: true });
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
    await rm(MARKER, { force: true });
  });

  test.describe('正常系', () => {
    test('run_command が一覧に出る', async ({ request }) => {
      const res = await request.get('/api/tools');
      const names = (await res.json()).tools.map(
        (tool: { name: string }) => tool.name
      );
      expect(names).toContain('run_command');
    });

    test('承認カードにコマンドと作業フォルダが出て、許可すると実行される', async ({
      page,
    }) => {
      test.skip(IS_LIGHT_MODEL, '軽量モデルはツール呼び出しが不安定なため');
      test.setTimeout(240000);

      await askToRun(page);
      const card = approvalCard(page);
      await expect(card).toBeVisible({ timeout: 200000 });
      await expect(card).toContainText('コマンドを実行します');
      await expect(card.getByLabel('実行するコマンド')).toContainText(
        '$ node -e'
      );
      await expect(card).toContainText('作業フォルダ');
      // 許可するまでは実行されない
      expect(await exists(MARKER)).toBe(false);

      await card.getByRole('button', { name: '許可' }).click();
      await expect(card).toBeHidden();
      await waitForResponseComplete(page, 200000);
      expect(await exists(MARKER)).toBe(true);
      await expect(
        page.locator('button', { hasText: '終了コード 0' }).first()
      ).toContainText('✅');
    });
  });

  test.describe('準正常系', () => {
    test('拒否すると実行されず、❌ と拒否が出る', async ({ page }) => {
      test.skip(IS_LIGHT_MODEL, '軽量モデルはツール呼び出しが不安定なため');
      test.setTimeout(240000);

      await askToRun(page);
      const card = approvalCard(page);
      await expect(card).toBeVisible({ timeout: 200000 });
      await card.getByRole('button', { name: '拒否' }).click();
      await waitForResponseComplete(page, 200000);

      expect(await exists(MARKER)).toBe(false);
      await expect(
        page.locator('button', { hasText: '拒否されました' }).first()
      ).toContainText('❌');
    });
  });

  test.describe('異常系', () => {
    test('失敗したコマンド（終了コード 0 以外）は、許可して実行した後に ❌ と終了コードが出る', async ({
      page,
    }) => {
      test.skip(IS_LIGHT_MODEL, '軽量モデルはツール呼び出しが不安定なため');
      test.setTimeout(240000);

      await page.addInitScript(() =>
        localStorage.setItem('agent-tools-enabled', 'true')
      );
      await page.goto('/');
      await sendMessage(
        page,
        `run_command で、作業フォルダ ${E2E_WRITE_DIR} で次のコマンドを実行してください: node -e "process.exit(3)"`
      );
      const card = approvalCard(page);
      await expect(card).toBeVisible({ timeout: 200000 });
      await card.getByRole('button', { name: '許可' }).click();
      await waitForResponseComplete(page, 200000);

      await expect(
        page.locator('button', { hasText: '終了コード 3' }).first()
      ).toContainText('❌');
    });
  });
});
