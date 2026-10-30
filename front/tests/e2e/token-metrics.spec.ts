import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { E2E_OLLAMA_MODEL } from './helpers/model';
import {
  cleanupAllConversations,
  createConversation,
  createMessage,
  fetchConversations,
  fetchMessages,
  sendMessage,
  waitForResponseComplete,
} from './helpers/test-data';

/**
 * 応答のトークン数・生成速度の表示（#31。`docs/19-token-metrics.md`「表示」）の E2E。
 *
 * 表示は API で保存した会話を開いて確かめる（軽量モデル・CI でも動く）。
 * 実際に生成して出ることは、生成の完了を待つため CI ではスキップする（`chat-streaming.spec.ts` と同じ）。
 * 値の集め方・ストリームでの受け渡しは IT（chat.test.ts・chat-agent.test.ts）、表示の文字列は UT（token-metrics.test.ts）が担う。
 */

/** 保存する応答の値（312 トークン / 7.41 秒 = 42.1 トークン/秒） */
const METRICS = {
  model: 'qwen3.8:27b',
  calls: 1,
  promptTokens: 1204,
  promptCachedTokens: 1180,
  maxPromptTokens: 1204,
  promptDurationMs: 312,
  outputTokens: 312,
  outputDurationMs: 7410,
  loadDurationMs: 3,
  totalDurationMs: 7800,
};

/**
 * 応答の metadata を指定して会話を保存し、開く。
 *
 * @param page - 対象のページ
 * @param request - API を呼ぶコンテキスト
 * @param title - 会話のタイトル
 * @param metadata - 応答の metadata
 */
async function openSavedAnswer(
  page: Page,
  request: APIRequestContext,
  title: string,
  metadata: Record<string, unknown>
) {
  const conv = await createConversation(request, title);
  await createMessage(request, conv.id, 'user', '挨拶して');
  await createMessage(request, conv.id, 'assistant', 'こんにちは！', metadata);
  await page.goto('/');
  await page.getByText(title).click();
  await expect(page.getByText('こんにちは！')).toBeVisible();
}

/**
 * トークン数の要約のボタン。
 *
 * @param page - 対象のページ
 * @returns 要約のボタンのロケーター
 */
function summary(page: Page) {
  // サイドバーの会話のタイトル（「トークン数の会話」等）のボタンに当たらないよう、チャットの欄に絞る
  return page.getByRole('main').getByRole('button', { name: /トークン/ });
}

/**
 * 内訳。
 *
 * @param page - 対象のページ
 * @returns 内訳のロケーター
 */
function details(page: Page) {
  return page.getByLabel('トークン数と所要時間の内訳');
}

test.describe('トークン数・生成速度の表示', () => {
  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('保存した応答の下にトークン数と速さが出て、押すと内訳が開閉する', async ({
      page,
      request,
    }) => {
      await openSavedAnswer(page, request, 'トークン数の会話', {
        metrics: METRICS,
      });

      await expect(summary(page)).toHaveText('312 トークン · 42.1 トークン/秒');
      await expect(summary(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(details(page)).toBeHidden();

      await summary(page).click();
      await expect(summary(page)).toHaveAttribute('aria-expanded', 'true');
      await expect(details(page)).toContainText('qwen3.8:27b');
      await expect(details(page)).toContainText(
        '312 トークン（思考を含む）・7.4 秒'
      );
      await expect(details(page)).toContainText(
        '1,204 トークン（キャッシュ 1,180）・0.3 秒'
      );
      // 1 回の問い合わせ・読み込み済みのモデルでは、最大の文脈と読み込みの時間は出さない
      await expect(details(page)).not.toContainText('最大の文脈');
      await expect(details(page)).not.toContainText('モデルの読み込み');

      await summary(page).click();
      await expect(details(page)).toBeHidden();
    });

    test('エージェントの応答では、ラウンド数と並べて出し、内訳に最大の文脈と読み込みの時間を出す', async ({
      page,
      request,
    }) => {
      await openSavedAnswer(page, request, 'エージェントのトークン数', {
        agentRounds: 3,
        agentDurationMs: 21000,
        metrics: {
          ...METRICS,
          calls: 3,
          promptTokens: 6000,
          maxPromptTokens: 2400,
          loadDurationMs: 2800,
        },
      });

      await expect(page.getByText('3 ラウンド')).toBeVisible();
      await summary(page).click();
      await expect(details(page)).toContainText('最大の文脈');
      await expect(details(page)).toContainText('2,400 トークン');
      await expect(details(page)).toContainText('モデルの読み込み');
      await expect(details(page)).toContainText('2.8 秒');
    });

    test('通常のチャットの応答にトークン数と速さが出て、その値を保存する', async ({
      page,
      request,
    }) => {
      test.skip(
        !!process.env.CI,
        'CI環境(CPU only)ではストリーミング完了まで時間がかかりすぎるためスキップ'
      );
      test.setTimeout(180000);

      await page.goto('/');
      await sendMessage(page, 'こんにちは');
      await waitForResponseComplete(page);

      await expect(summary(page)).toHaveText(
        /^[\d,]+ トークン · [\d.]+ トークン\/秒$/
      );
      await summary(page).click();
      await expect(details(page)).toContainText(E2E_OLLAMA_MODEL);

      // 表示と同じ値を応答の metadata に保存している（開き直したときの表示は上のテストが確かめる）
      await expect
        .poll(async () => {
          const [conv] = await fetchConversations(request);
          if (!conv) return undefined;
          const messages = await fetchMessages(request, conv.id);
          const answer = messages.find((m) => m.role === 'assistant');
          // metadata は任意の JSON（Record<string, unknown>）のため、見る項目の形だけを当てる（無ければ undefined になるだけ）
          return (answer?.metadata as { metrics?: { model?: string } } | null)
            ?.metrics?.model;
        })
        .toBe(E2E_OLLAMA_MODEL);
    });
  });

  test.describe('準正常系', () => {
    test('値の無い応答（停止した・この機能より前の応答）には出さない', async ({
      page,
      request,
    }) => {
      await openSavedAnswer(page, request, '値の無い会話', {});

      await expect(summary(page)).toHaveCount(0);
    });

    test('生成の時間が 0 なら速さを出さず、トークン数だけを出す', async ({
      page,
      request,
    }) => {
      await openSavedAnswer(page, request, '速さの無い会話', {
        metrics: { ...METRICS, outputTokens: 1, outputDurationMs: 0 },
      });

      await expect(summary(page)).toHaveText('1 トークン');
    });
  });

  test.describe('異常系', () => {
    test('保存済みの値の形が合わなければ出さず、応答は表示する', async ({
      page,
      request,
    }) => {
      await openSavedAnswer(page, request, '壊れた値の会話', {
        metrics: { ...METRICS, outputTokens: 'たくさん', calls: 0 },
      });

      await expect(summary(page)).toHaveCount(0);
      await expect(page.getByText('こんにちは！')).toBeVisible();
    });
  });
});
