import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { access, rm } from 'fs/promises';
import path from 'path';
import { E2E_WRITE_DIR } from './helpers/local-files';
import { IS_LIGHT_MODEL } from './helpers/model';
import { stopButton } from './helpers/long-answer';
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
 * 承認カードの残り時間（#202）は、どの承認カードも同じ部品のためここで確かめる。時間切れは 5 分を待たず、
 * ブラウザの時計（`page.clock`）を進めて起こす（ブラウザ API の境界。サーバーの待ち時間はそのまま）。
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

/**
 * 承認カードの残り時間（#202）。
 *
 * @param page - 対象のページ
 * @returns 残り時間のロケーター
 */
function countdown(page: Page) {
  return approvalCard(page).getByRole('timer', { name: '承認の残り時間' });
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
      // 承認の待ち時間（5 分）の残りが出る（#202）
      await expect(countdown(page)).toHaveText(/残り [45]:\d\d/);
      // 許可するまでは実行されない。結果の欄は ✅ ではなく承認待ち（#192）
      expect(await exists(MARKER)).toBe(false);
      const pending = page.locator('button', { hasText: 'コマンドを実行' });
      await expect(pending.first()).toContainText('承認待ち');
      await expect(pending.first()).not.toContainText('✅');

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

    test('承認の時間切れが近づくと残り時間が警告の色になり、時間切れでは許可・拒否を押せない', async ({
      page,
    }) => {
      test.skip(IS_LIGHT_MODEL, '軽量モデルはツール呼び出しが不安定なため');
      test.setTimeout(240000);

      // ページの読み込みより前に入れる（残り時間を数えるタイマーを、進められる時計に載せる）
      await page.clock.install();
      await askToRun(page);
      const card = approvalCard(page);
      await expect(card).toBeVisible({ timeout: 200000 });
      await expect(countdown(page)).toHaveText(/残り [45]:\d\d/);

      await page.clock.fastForward('04:01');
      await expect(countdown(page)).toHaveText(/残り 0:[0-5]\d/);
      await expect(countdown(page)).toHaveClass(/text-nord-aurora-yellow/);
      await expect(card.getByRole('button', { name: '許可' })).toBeEnabled();

      await page.clock.fastForward('01:00');
      await expect(countdown(page)).toHaveText('時間切れ');
      await expect(card.getByRole('button', { name: '許可' })).toBeDisabled();
      await expect(card.getByRole('button', { name: '拒否' })).toBeDisabled();

      // サーバーはまだ待っている（ブラウザの時計だけを進めた）。停止で取り消し、実行されないことを確かめる
      await stopButton(page).click();
      await expect(card).toBeHidden();
      expect(await exists(MARKER)).toBe(false);
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
