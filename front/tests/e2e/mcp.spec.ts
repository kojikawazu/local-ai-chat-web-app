import type { Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { IS_LIGHT_MODEL } from './helpers/model';
import {
  deleteConversation,
  fetchConversations,
  sendMessage,
} from './helpers/test-data';

/**
 * MCP のサーバーへの接続（#208。`docs/31-mcp-client.md`）の E2E。
 *
 * 設定の状態の表示は軽量モデルでも確かめる（`helpers/mcp.ts` の設定で、接続できる・起動できない・設定の誤りのサーバーを並べる）。
 * 実際にツールを呼ばせるテストはツール呼び出しが要るため、軽量モデルではスキップする。接続・承認・持ち出しの配線は
 * IT（chat-agent-mcp.test.ts）が担う。
 *
 * 開発の DB を使う。ほかの spec と違い、開発者の会話を消さないよう、このファイルで増えた会話だけを消す。
 */

/** テストの前からある会話の ID */
let existing: Set<string>;

test.beforeEach(async ({ request }) => {
  existing = new Set(
    (await fetchConversations(request)).map((conversation) => conversation.id)
  );
});

test.afterEach(async ({ request }) => {
  for (const conversation of await fetchConversations(request)) {
    if (!existing.has(conversation.id)) {
      await deleteConversation(request, conversation.id);
    }
  }
});

/**
 * 設定を開く。
 *
 * @param page - 対象のページ
 * @returns 名前が「設定」のダイアログ
 */
async function openSettings(page: Page) {
  await page.goto('/');
  await page
    .locator('aside')
    .getByRole('button', { name: '設定を開く' })
    .click();
  return page.getByRole('dialog', { name: '設定' });
}

/**
 * サーバーの一覧の 1 行。
 *
 * @param page - 対象のページ
 * @param name - サーバーの名前
 * @returns 一覧の行のロケーター
 */
function serverRow(page: Page, name: string) {
  return page
    .getByRole('region', { name: 'MCP サーバー' })
    .getByRole('listitem')
    .filter({ hasText: name });
}

/**
 * エージェントモードでメッセージを送る。
 *
 * @param page - 対象のページ
 * @param message - 送るメッセージ
 */
async function askAgent(page: Page, message: string) {
  await page.addInitScript(() =>
    localStorage.setItem('agent-tools-enabled', 'true')
  );
  await page.goto('/');
  await sendMessage(page, message);
}

/**
 * エージェントの応答の終わりを待つ。
 *
 * `waitForResponseComplete` は送信ボタンが押せるのを待つが、エージェントモードの生成中は「割り込む」（#241）で
 * 押せてしまい、すぐ通過するため、「生成を停止」が消えるのを待つ。
 *
 * @param page - 対象のページ
 */
async function waitForAgentDone(page: Page) {
  await expect(page.getByRole('button', { name: '生成を停止' })).toHaveCount(
    0,
    { timeout: 150_000 }
  );
}

/**
 * ツールの結果の見出しを開いて、結果の本文を確かめる。
 *
 * @param page - 対象のページ
 * @param label - ツールの見出し
 * @returns 見出しのロケーター
 */
function toolHeading(page: Page, label: string) {
  return page.getByRole('button', { name: new RegExp(label) }).first();
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

test.describe('MCP のサーバー', () => {
  test.describe('正常系', () => {
    test('設定に接続中のサーバーとツールの数を出す', async ({ page }) => {
      await openSettings(page);

      const row = serverRow(page, 'notes');
      await expect(row).toContainText('接続中');
      await expect(row).toContainText('ツール 2 個');
    });

    test('読むツールは承認なしで実行する', async ({ page }) => {
      test.skip(IS_LIGHT_MODEL, 'ツールの呼び出しが要る');
      test.setTimeout(180_000);

      await askAgent(
        page,
        'mcp__notes__read_note で ID が 1 のメモを読んで、合言葉を教えてください'
      );
      await waitForAgentDone(page);

      await expect(approvalCard(page)).toHaveCount(0);
      await expect(toolHeading(page, 'notes: read_note')).toBeVisible();
      await expect(page.getByText(/オーロラ/).first()).toBeVisible();
    });

    test('書くツールは承認カードに引数を出し、許可の後に実行する', async ({
      page,
    }) => {
      test.skip(IS_LIGHT_MODEL, 'ツールの呼び出しが要る');
      test.setTimeout(180_000);

      await askAgent(
        page,
        'mcp__notes__write_note で本文を「買い物メモ」にしてメモを書いてください'
      );

      const card = approvalCard(page);
      await expect(card).toBeVisible({ timeout: 120_000 });
      await expect(card).toContainText('MCP のツールを実行します');
      await expect(card.getByLabel('送る引数')).toContainText('買い物メモ');

      await card.getByRole('button', { name: '許可' }).click();
      await waitForAgentDone(page);
      await expect(approvalCard(page)).toHaveCount(0);

      await toolHeading(page, 'notes: write_note').click();
      await expect(
        page.getByText('notes に書きました: 買い物メモ').first()
      ).toBeVisible();
    });
  });

  test.describe('準正常系', () => {
    test('設定の誤りのサーバーは理由を出す', async ({ page }) => {
      await openSettings(page);

      const row = serverRow(page, 'broken');
      await expect(row).toContainText('設定の誤り');
      await expect(row).toContainText('知らない項目です: url');
    });

    test('拒否すると実行しない', async ({ page }) => {
      test.skip(IS_LIGHT_MODEL, 'ツールの呼び出しが要る');
      test.setTimeout(180_000);

      await askAgent(
        page,
        'mcp__notes__write_note で本文を「買い物メモ」にしてメモを書いてください'
      );

      const card = approvalCard(page);
      await expect(card).toBeVisible({ timeout: 120_000 });
      await card.getByRole('button', { name: '拒否' }).click();
      await waitForAgentDone(page);

      await expect(page.getByText('拒否されました').first()).toBeVisible();
    });
  });

  test.describe('異常系', () => {
    test('起動できないサーバーは失敗の理由を出す', async ({ page }) => {
      await openSettings(page);

      const row = serverRow(page, 'gone');
      await expect(row).toContainText('失敗');
      await expect(row).toContainText('ENOENT');
    });

    test('状態を読めなくても設定は開き、一覧を出さない', async ({ page }) => {
      await page.route('**/api/tools', (route) =>
        route.fulfill({ status: 500, body: '{"error":"x"}' })
      );

      const settings = await openSettings(page);

      await expect(settings).toBeVisible();
      await expect(
        page.getByRole('region', { name: 'MCP サーバー' })
      ).toHaveCount(0);
    });
  });
});
