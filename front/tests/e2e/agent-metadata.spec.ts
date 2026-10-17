import { test, expect } from '@playwright/test';
import {
  cleanupAllConversations,
  createConversation,
  createMessage,
  sendMessage,
  waitForResponseComplete,
} from './helpers/test-data';

/**
 * エージェント応答の付随情報（思考過程・ツール呼び出し・ラウンド数・所要時間）が、
 * 会話を開き直した後も表示されることの E2E（#94）。
 *
 * 保存済みの metadata の復元はモデルに依存しないため、API でメッセージを用意して検証する
 * （軽量モデル・CI でも動く）。実際のエージェント応答を保存して復元する流れは、
 * ツールを呼ぶかに関わらず done イベントで届くラウンド数を手がかりに検証する。
 */

/** 保存済みのツール呼び出し（`get_current_datetime` は画面で「日時を取得」と表示される） */
const TOOL_CALL = {
  name: 'get_current_datetime',
  arguments: { timezone: 'Asia/Tokyo' },
  result: '2026-10-17T21:25:52+09:00',
  isError: false,
  durationMs: 1,
};

test.describe('エージェント応答の付随情報の復元', () => {
  test.setTimeout(180000);

  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('保存済みの応答を開くと、思考過程・ツール結果・ラウンド数・所要時間が表示される', async ({
      page,
      request,
    }) => {
      const conv = await createConversation(request, '付随情報の復元');
      await createMessage(request, conv.id, 'user', '今の日時を教えてください');
      await createMessage(request, conv.id, 'assistant', '今は 21 時です', {
        toolCalls: [TOOL_CALL],
        thinkingText: '時刻を調べる\n\n取得した時刻を伝える',
        agentRounds: 2,
        agentDurationMs: 14800,
      });

      await page.goto('/');
      await page.getByText('付随情報の復元').click();

      await expect(page.getByText('今は 21 時です')).toBeVisible();
      await expect(page.getByText('思考過程')).toBeVisible();
      await expect(page.getByText('取得した時刻を伝える')).toBeVisible();
      await expect(page.getByText('日時を取得')).toBeVisible();
      await expect(page.getByText('2 ラウンド')).toBeVisible();
      await expect(page.getByText('14.8s')).toBeVisible();
    });

    test('エージェントの応答を再読み込みしても、ラウンド数と思考過程が表示される', async ({
      page,
    }) => {
      // ラウンド数はツールを呼ばなくても done イベントで届くため、軽量モデルでも検証できる。
      // ツールを使わない応答の metadata が保存されず消えていた不具合（#94）を捉える
      test.skip(
        !!process.env.CI,
        'CI環境(CPU only)ではエージェント応答の完了まで時間がかかりすぎるためスキップ'
      );

      await page.goto('/');
      await page.evaluate(() =>
        localStorage.setItem('agent-tools-enabled', 'true')
      );
      await page.reload();

      await sendMessage(page, 'こんにちは');
      await waitForResponseComplete(page);
      await expect(page.getByText(/\d+ ラウンド/)).toBeVisible();
      // 思考過程を返すかはモデルに依存するため、応答直後に出ていた場合だけ復元を確かめる
      const hadThinking = await page.getByText('思考過程').isVisible();

      // 再読み込みすると会話は未選択に戻るため、履歴の唯一の会話を開き直す
      await page.reload();
      await page.locator('nav button').first().click();

      await expect(page.getByText(/\d+ ラウンド/)).toBeVisible();
      if (hadThinking) {
        await expect(page.getByText('思考過程')).toBeVisible();
      }

      await page.evaluate(() =>
        localStorage.setItem('agent-tools-enabled', 'false')
      );
    });
  });

  test.describe('準正常系', () => {
    test('ツール呼び出しが無く思考過程だけの応答も復元される', async ({
      page,
      request,
    }) => {
      const conv = await createConversation(request, '思考だけの応答');
      await createMessage(request, conv.id, 'user', 'こんにちは');
      await createMessage(request, conv.id, 'assistant', 'こんにちは！', {
        thinkingText: '挨拶を返す',
        agentRounds: 1,
        agentDurationMs: 3000,
      });

      await page.goto('/');
      await page.getByText('思考だけの応答').click();

      await expect(page.getByText('挨拶を返す')).toBeVisible();
      await expect(page.getByText('1 ラウンド')).toBeVisible();
      await expect(page.getByText('3.0s')).toBeVisible();
    });
  });

  test.describe('異常系', () => {
    test('metadata の不正な項目は表示せず、残りの項目と本文は表示する', async ({
      page,
      request,
    }) => {
      const conv = await createConversation(request, '不正な付随情報');
      await createMessage(request, conv.id, 'user', 'テスト');
      await createMessage(request, conv.id, 'assistant', '本文は表示される', {
        toolCalls: 'oops',
        thinkingText: '思考は表示される',
        agentRounds: 'abc',
      });

      await page.goto('/');
      await page.getByText('不正な付随情報').click();

      await expect(page.getByText('本文は表示される')).toBeVisible();
      await expect(page.getByText('思考は表示される')).toBeVisible();
      await expect(page.getByText(/ラウンド/)).toHaveCount(0);
    });
  });
});
