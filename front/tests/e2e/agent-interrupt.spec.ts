import type { Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { IS_LIGHT_MODEL } from './helpers/model';
import {
  cleanupAllConversations,
  createConversation,
  createMessage,
  sendMessage,
} from './helpers/test-data';

/**
 * 応答の途中の指示（割り込み。#241。`docs/30-agent-interrupt.md`）の E2E。
 *
 * 「割り込む」のボタンの出し分けと、保存した応答の指示の表示は軽量モデルでも確かめる（`/api/chat` は通信の境界で止め、
 * 保存した応答は API で入れる）。実際に割り込んで読まれるか・指示の API の失敗で入力欄に戻るかは、ツール呼び出しが要るため
 * 軽量モデルではスキップする。区切りで読む・本文の後も続ける・サブエージェントのまとめ始めは IT（chat-agent-instruction.test.ts）が担う。
 */

/**
 * エージェントモードを保存した状態でページを開く。
 *
 * @param page - 対象のページ
 * @param tools - エージェントモードにするか
 */
async function openWithAgentMode(page: Page, tools: boolean) {
  await page.addInitScript((enabled) => {
    if (localStorage.getItem('agent-tools-enabled') !== null) return;
    localStorage.setItem('agent-tools-enabled', String(enabled));
    localStorage.setItem('agent-sub-agents-enabled', 'false');
  }, tools);
  await page.goto('/');
}

/**
 * 「割り込む」のボタン。
 *
 * @param page - 対象のページ
 * @returns ボタン
 */
function interruptButton(page: Page) {
  return page.locator('form').getByRole('button', { name: '割り込む' });
}

/**
 * `/api/chat` を通信の境界で止め、離すまで応答しない（生成中の画面を作る）。
 *
 * @param page - 対象のページ
 * @returns 止めた応答を返す関数
 */
async function holdChat(page: Page) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/chat', async (route) => {
    await released;
    await route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body:
        [
          JSON.stringify({ type: 'text_delta', content: '答えです。' }),
          JSON.stringify({ type: 'done', metadata: { toolCalls: [] } }),
        ].join('\n') + '\n',
    });
  });
  return release;
}

test.describe('応答の途中の指示（割り込み）', () => {
  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('保存した応答の指示は、読んだ位置（ツールの後）に「追加の指示」として出る', async ({
      page,
      request,
    }) => {
      const conv = await createConversation(request, '割り込みの記録');
      await createMessage(
        request,
        conv.id,
        'user',
        'Ollama の最近の変更を調べて'
      );
      await createMessage(
        request,
        conv.id,
        'assistant',
        '調べます。日本語の出典で 3 行にまとめました。',
        {
          toolCalls: [
            {
              name: 'web_search',
              arguments: { query: 'Ollama' },
              result: '一覧',
              isError: false,
              summary: '5 件',
              durationMs: 100,
              contentOffset: 5,
            },
          ],
          instructions: [
            {
              content: '日本語の出典だけで 3 行に',
              contentOffset: 5,
              toolCallIndex: 1,
            },
          ],
        }
      );
      await page.goto('/');
      await page.getByText('割り込みの記録').click();

      const main = page.getByRole('main');
      const note = main.getByRole('note', { name: '追加の指示', exact: true });
      await expect(note).toContainText('日本語の出典だけで 3 行に');
      // 時系列の順: ツールの結果 → 追加の指示 → 答え
      const order = await main
        .locator(':is([role="note"], button:has-text("Web 検索"))')
        .evaluateAll((elements) =>
          elements.map((element) =>
            element.getAttribute('role') === 'note' ? 'note' : 'tool'
          )
        );
      expect(order).toEqual(['tool', 'note']);
      await expect(
        main.getByText('日本語の出典で 3 行にまとめました。')
      ).toBeVisible();
    });

    test('大きいモデルの調べものの途中で割り込むと、次の区切りで読まれて「追加の指示」が出る', async ({
      page,
    }) => {
      test.skip(IS_LIGHT_MODEL, '軽量モデルはツール呼び出しが不安定なため');
      test.setTimeout(420000);
      await openWithAgentMode(page, true);
      await sendMessage(page, 'Ollama の最近のリリースで何が変わったか調べて');

      // 最初のツールが始まったら割り込む
      await expect(
        page
          .getByRole('main')
          .getByRole('button', { name: /Web 検索|URL を取得/ })
          .first()
      ).toBeVisible({ timeout: 300000 });
      await page
        .locator('textarea')
        .fill('日本語の出典だけを使って、箇条書き 3 行でまとめて');
      await expect(interruptButton(page)).toBeEnabled();
      await interruptButton(page).click();

      const main = page.getByRole('main');
      await expect(
        main.getByRole('note', { name: '追加の指示', exact: true })
      ).toContainText('箇条書き 3 行', { timeout: 300000 });
      await page.getByRole('button', { name: '生成を停止' }).click();
    });
  });

  test.describe('準正常系', () => {
    test('エージェントモードの生成中だけ「割り込む」を出し、応答の ID が届くまで押せない', async ({
      page,
    }) => {
      await openWithAgentMode(page, true);
      const release = await holdChat(page);
      await sendMessage(page, '調べて');

      await expect(interruptButton(page)).toBeVisible();
      // 文を入れても、応答の ID（response_started）が届くまでは押せない
      await page.locator('textarea').fill('日本語だけで');
      await expect(interruptButton(page)).toBeDisabled();
      await expect(
        page.getByRole('button', { name: '生成を停止' })
      ).toBeVisible();
      release();
      await expect(page.getByText('答えです。')).toBeVisible();
      await expect(interruptButton(page)).toHaveCount(0);
    });

    test('通常のチャットの生成中は「割り込む」を出さない', async ({ page }) => {
      await openWithAgentMode(page, false);
      const release = await holdChat(page);
      await sendMessage(page, 'こんにちは');

      await expect(
        page.getByRole('button', { name: '生成を停止' })
      ).toBeVisible();
      await expect(interruptButton(page)).toHaveCount(0);
      release();
      await expect(page.getByText('答えです。')).toBeVisible();
    });

    test('読まれなかった指示は「読まれませんでした」として出る（保存した応答）', async ({
      page,
      request,
    }) => {
      const conv = await createConversation(request, '読まれなかった指示');
      await createMessage(request, conv.id, 'user', '調べて');
      await createMessage(request, conv.id, 'assistant', '途中まで', {
        interrupted: true,
        instructions: [{ content: '英語は読まない', unread: true }],
      });
      await page.goto('/');
      await page.getByText('読まれなかった指示').click();

      await expect(
        page
          .getByRole('main')
          .getByRole('note', { name: '追加の指示（読まれませんでした）' })
      ).toContainText('英語は読まない');
    });
  });

  test.describe('異常系', () => {
    test('指示の API が失敗したら、エラーを出して文を入力欄に戻す', async ({
      page,
    }) => {
      test.skip(IS_LIGHT_MODEL, '軽量モデルはツール呼び出しが不安定なため');
      test.setTimeout(420000);
      await page.route('**/api/agent/responses/*/instructions', (route) =>
        route.fulfill({
          status: 409,
          json: { error: '1 回の応答で送れる指示は5件までです' },
        })
      );
      await openWithAgentMode(page, true);
      await sendMessage(page, 'Ollama の最近のリリースで何が変わったか調べて');
      await page.locator('textarea').fill('日本語だけで');
      await expect(interruptButton(page)).toBeEnabled({ timeout: 300000 });
      await interruptButton(page).click();

      await expect(
        page.getByText('1 回の応答で送れる指示は5件までです')
      ).toBeVisible();
      await expect(page.locator('textarea')).toHaveValue('日本語だけで');
      await page.getByRole('button', { name: '生成を停止' }).click();
    });
  });
});
