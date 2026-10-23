import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  cleanupAllConversations,
  createConversation,
  createMessage,
} from './helpers/test-data';

/**
 * ツールの結果パネルの見出しに、結果の要約（件数等）と成否が出ることの E2E（#150）。
 *
 * 要約・成否はツールが返し、`done` の `toolCalls` として metadata に保存される。表示は保存済みの
 * metadata から復元する経路と同じため、API でメッセージを用意して検証する（モデルがツールを
 * 呼ぶかに依存せず、軽量モデル・CI でも動く）。ツールが要約・成否を返す契約は UT / IT で担保する。
 */

/** 保存済みの web_search 呼び出し（画面で「Web 検索」と表示される）。要約・成否は各テストで足す */
const WEB_SEARCH = {
  name: 'web_search',
  arguments: { query: 'Next.js 16' },
  result: '"Next.js 16" の検索結果 (上位5件):\n',
  isError: false,
  durationMs: 1234,
};

/**
 * ツール呼び出し 1 件を持つ応答を保存し、その会話を開く。
 *
 * @param page - 会話を開くページ
 * @param request - 会話・メッセージを作る API クライアント
 * @param title - 会話のタイトル（サイドバーで開くのに使う）
 * @param toolCall - 保存するツール呼び出し
 * @returns ツールの結果パネルの見出し（展開ボタン）
 */
async function openWithToolCall(
  page: Page,
  request: Parameters<typeof createConversation>[0],
  title: string,
  toolCall: Record<string, unknown>
) {
  const conv = await createConversation(request, title);
  await createMessage(request, conv.id, 'user', 'Next.js 16 について調べて');
  await createMessage(request, conv.id, 'assistant', '調べた結果です', {
    toolCalls: [toolCall],
    agentRounds: 2,
  });

  await page.goto('/');
  await page.getByText(title).click();
  await expect(page.getByText('調べた結果です')).toBeVisible();
  return page.locator('button', { hasText: 'Web 検索' });
}

test.describe('ツールの結果の要約', () => {
  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('検索の件数が見出しに ✅ とともに出る', async ({ page, request }) => {
      const header = await openWithToolCall(page, request, '検索の件数', {
        ...WEB_SEARCH,
        summary: '5 件',
      });

      await expect(header).toContainText('✅');
      await expect(header).toContainText('5 件');
      await expect(header).toContainText('1234ms');
    });
  });

  test.describe('準正常系', () => {
    test('0 件は ✅ ではなく ⚠️ で出る', async ({ page, request }) => {
      const header = await openWithToolCall(page, request, '検索の0件', {
        ...WEB_SEARCH,
        result: '"Next.js 16" の検索結果が見つかりませんでした。',
        summary: '0 件',
        isEmpty: true,
      });

      await expect(header).toContainText('⚠️');
      await expect(header).toContainText('0 件');
      await expect(header).not.toContainText('✅');
    });

    test('要約を持たない古いデータは、これまでどおり成否と所要時間だけを出す', async ({
      page,
      request,
    }) => {
      const header = await openWithToolCall(
        page,
        request,
        '要約なしの古いデータ',
        WEB_SEARCH
      );

      await expect(header).toContainText('✅');
      await expect(header).not.toContainText('件');
      await expect(header).toContainText('1234ms');
    });
  });

  test.describe('異常系', () => {
    test('失敗は ❌ と理由が出て、長い理由の全文はツールチップで読める', async ({
      page,
      request,
    }) => {
      const reason =
        'SearXNG（http://localhost:8888）に接続できません。プロジェクトのルートで `docker compose up -d` を実行して起動してください。起動するまで、検索し直しても結果は得られません。';
      const header = await openWithToolCall(page, request, '検索の失敗', {
        ...WEB_SEARCH,
        result: `エラー: ${reason}`,
        isError: true,
        summary: reason,
      });

      await expect(header).toContainText('❌');
      await expect(header).not.toContainText('✅');
      // 見出しには 1 行に収めて出し、全文は title 属性で読ませる
      await expect(header.getByTitle(reason)).toBeVisible();

      // 展開すると、結果の全文がエラーとして表示される
      await header.click();
      await expect(page.getByText(`エラー: ${reason}`)).toBeVisible();
    });
  });
});
