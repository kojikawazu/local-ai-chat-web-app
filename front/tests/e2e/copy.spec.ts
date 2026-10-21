import type { Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import {
  cleanupAllConversations,
  createConversation,
  createMessage,
} from './helpers/test-data';

/**
 * 応答・コードブロックのコピーと、その結果表示の E2E（#7）。
 *
 * コピー対象の応答は API で用意する（モデルの出力にコードブロックが含まれるとは限らず、
 * コピーの検証はモデルに依存しないため。軽量モデル・CI でも動く）。
 *
 * Clipboard API が無い環境・コピーの失敗は、実ブラウザでは安定して起こせないため、
 * `addInitScript` でブラウザ API の境界（`navigator.clipboard` / `execCommand`）だけを
 * 差し替える（`testing.md` の障害注入の例外）。アプリ側のロジックは差し替えない。
 */

declare global {
  interface Window {
    /** Clipboard API を消すテストで、検証用に退避した本物の Clipboard */
    __originalClipboard?: Clipboard;
  }
}

const TITLE = 'コピーの検証';

/** コードブロックを含む応答（Markdown の原文） */
const ANSWER = [
  '依存を入れてから起動します。',
  '',
  '```bash',
  'pnpm install',
  'pnpm dev',
  '```',
].join('\n');

/** 上の応答のコードブロックの中身（末尾の改行を含まない） */
const CODE = 'pnpm install\npnpm dev';

/**
 * コードブロック入りの会話を用意して開く。
 *
 * @param page - 対象のページ
 * @param request - API 呼び出しに使うリクエストコンテキスト
 */
async function openSeededConversation(
  page: Page,
  request: Parameters<typeof createConversation>[0]
) {
  const conv = await createConversation(request, TITLE);
  await createMessage(request, conv.id, 'user', '起動手順を教えてください');
  await createMessage(request, conv.id, 'assistant', ANSWER);

  await page.goto('/');
  await page.getByText(TITLE).click();
  await expect(page.getByText('依存を入れてから起動します。')).toBeVisible();
}

/**
 * クリップボードの中身を読む。Clipboard API を消したテストでは退避した本物から読む。
 *
 * @param page - 対象のページ
 * @returns クリップボードの文字列
 */
async function readClipboard(page: Page): Promise<string> {
  return page.evaluate(() =>
    (window.__originalClipboard ?? navigator.clipboard).readText()
  );
}

test.describe('コピー機能', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('応答のコピーボタンで Markdown の原文がコピーされ、「コピーしました」が表示される', async ({
      page,
      request,
    }) => {
      await openSeededConversation(page, request);

      await page.getByRole('button', { name: 'コピー', exact: true }).click();

      await expect(
        page.getByRole('status').filter({ hasText: 'コピーしました' })
      ).toBeVisible();
      expect(await readClipboard(page)).toBe(ANSWER);
    });

    test('コードブロックのコピーボタンでコードだけがコピーされる', async ({
      page,
      request,
    }) => {
      await openSeededConversation(page, request);

      await page.getByRole('button', { name: 'コードをコピー' }).click();

      await expect(
        page.getByRole('status').filter({ hasText: 'コピーしました' })
      ).toBeVisible();
      expect(await readClipboard(page)).toBe(CODE);
    });
  });

  test.describe('準正常系', () => {
    test('コピーの結果表示は一定時間後に消える', async ({ page, request }) => {
      await openSeededConversation(page, request);

      await page.getByRole('button', { name: 'コピー', exact: true }).click();
      const copied = page
        .getByRole('status')
        .filter({ hasText: 'コピーしました' });
      await expect(copied).toBeVisible();

      // 表示は 2 秒で戻る（COPY_FEEDBACK_RESET_MS）。余裕を見て 5 秒待つ
      await expect(copied).toHaveCount(0, { timeout: 5000 });
      await expect(
        page.getByRole('button', { name: 'コピー', exact: true })
      ).toBeVisible();
    });

    test('Clipboard API が無い環境（非 secure context 相当）でも、代わりのコピーでコピーできる', async ({
      page,
      request,
    }) => {
      await page.addInitScript(() => {
        // 本物は検証の読み出し用に退避し、アプリからは見えなくする
        window.__originalClipboard = navigator.clipboard;
        Object.defineProperty(Navigator.prototype, 'clipboard', {
          get: () => undefined,
          configurable: true,
        });
      });
      await openSeededConversation(page, request);

      await page.getByRole('button', { name: 'コードをコピー' }).click();

      await expect(
        page.getByRole('status').filter({ hasText: 'コピーしました' })
      ).toBeVisible();
      expect(await readClipboard(page)).toBe(CODE);
    });
  });

  test.describe('異常系', () => {
    test('コピーに失敗したら「コピーに失敗しました」を表示し、画面は操作できるまま', async ({
      page,
      request,
    }) => {
      await page.addInitScript(() => {
        // Clipboard API の拒否と、代わりのコピーの失敗を両方起こす
        Clipboard.prototype.writeText = () =>
          Promise.reject(new DOMException('denied', 'NotAllowedError'));
        Document.prototype.execCommand = () => false;
      });
      await openSeededConversation(page, request);

      await page.getByRole('button', { name: 'コピー', exact: true }).click();

      await expect(
        page.getByRole('status').filter({ hasText: 'コピーに失敗しました' })
      ).toBeVisible();
      await expect(
        page.getByText('依存を入れてから起動します。')
      ).toBeVisible();
      await expect(page.locator('textarea')).toBeEnabled();
    });
  });
});
