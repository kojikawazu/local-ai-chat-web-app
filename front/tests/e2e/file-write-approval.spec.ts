import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { E2E_WRITE_DIR } from './helpers/local-files';
import { IS_LIGHT_MODEL } from './helpers/model';
import {
  cleanupAllConversations,
  sendMessage,
  waitForResponseComplete,
} from './helpers/test-data';

/**
 * ファイルの書き込みの実行前の承認（#148 Phase A2）の E2E。
 *
 * dev サーバーには `playwright.config.ts` が `LOCAL_FILE_WRITE_ROOTS` として OS の一時フォルダの E2E 用のフォルダを渡す。
 * 承認の API の契約と、書き込みのツールの登録は軽量モデル・CI でも確かめる。モデルに書き込みを頼んで承認カードを
 * 操作するテストはツール呼び出しが要るため、軽量モデルではスキップする。
 * 承認の流れ（許可・拒否・停止）の契約は IT（chat-agent-approval.test.ts）、書き込みの判定は IT（local-file-write.test.ts）が担う。
 */

const FILE = path.join(E2E_WRITE_DIR, 'greeting.txt');
const ORIGINAL = 'Hello\n';

/**
 * エージェントモードで、ファイルの書き換えを頼む。
 *
 * @param page - 対象のページ
 */
async function askToEdit(page: Page) {
  await page.addInitScript(() =>
    localStorage.setItem('agent-tools-enabled', 'true')
  );
  await page.goto('/');
  await sendMessage(
    page,
    `edit_file で ${FILE} の Hello を こんにちは に書き換えてください`
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

test.describe('ファイルの書き込みの承認', () => {
  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
    await writeFile(FILE, ORIGINAL);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('書き込みのツールが一覧に出る', async ({ request }) => {
      const res = await request.get('/api/tools');
      const names = (await res.json()).tools.map(
        (tool: { name: string }) => tool.name
      );
      expect(names).toEqual(
        expect.arrayContaining(['write_file', 'edit_file'])
      );
    });

    test('承認カードに差分が出て、許可するとファイルが書き換わる', async ({
      page,
    }) => {
      test.skip(IS_LIGHT_MODEL, '軽量モデルはツール呼び出しが不安定なため');
      test.setTimeout(240000);

      await askToEdit(page);
      const card = approvalCard(page);
      await expect(card).toBeVisible({ timeout: 200000 });
      await expect(card).toContainText('ファイルを編集します');
      await expect(card.getByLabel('変更の差分')).toContainText('+こんにちは');
      // 承認するまでは書き換わらない。結果の欄は ✅ ではなく承認待ち（#192）
      expect(await readFile(FILE, 'utf8')).toBe(ORIGINAL);
      const pending = page.locator('button', { hasText: '承認待ち' });
      await expect(pending.first()).toBeVisible();
      await expect(pending.first()).not.toContainText('✅');

      await card.getByRole('button', { name: '許可' }).click();
      await expect(card).toBeHidden();
      await waitForResponseComplete(page, 200000);
      expect(await readFile(FILE, 'utf8')).toBe('こんにちは\n');
      await expect(
        page.locator('button', { hasText: 'greeting.txt を編集' }).first()
      ).toContainText('✅');
    });
  });

  test.describe('準正常系', () => {
    test('拒否するとファイルは書き換わらず、❌ と拒否が出る', async ({
      page,
    }) => {
      test.skip(IS_LIGHT_MODEL, '軽量モデルはツール呼び出しが不安定なため');
      test.setTimeout(240000);

      await askToEdit(page);
      const card = approvalCard(page);
      await expect(card).toBeVisible({ timeout: 200000 });
      await card.getByRole('button', { name: '拒否' }).click();
      await waitForResponseComplete(page, 200000);

      expect(await readFile(FILE, 'utf8')).toBe(ORIGINAL);
      await expect(
        page.locator('button', { hasText: '拒否されました' }).first()
      ).toContainText('❌');
    });
  });

  test.describe('異常系', () => {
    test('待っている承認が無い ID は 404、不正な ID は 400', async ({
      request,
    }) => {
      const unknown = await request.post(
        `/api/agent/approvals/${crypto.randomUUID()}`,
        { data: { approved: true } }
      );
      expect(unknown.status()).toBe(404);
      const invalid = await request.post('/api/agent/approvals/not-a-uuid', {
        data: { approved: true },
      });
      expect(invalid.status()).toBe(400);
    });
  });
});
