import type { APIRequestContext, Page, Route } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { startLongAnswer, stopButton } from './helpers/long-answer';
import {
  cleanupAllConversations,
  createConversation,
  createMessage,
  fetchMessages,
  waitForResponseComplete,
} from './helpers/test-data';

/**
 * 応答の再生成の E2E（#9）。
 *
 * 再生成の元になる会話は API で投入する（送信で作った会話はタイトルの自動生成で名前が変わり、
 * 開く操作が不安定になるため）。生成は実際の Ollama に行わせ、生成の失敗・本文が出る前の停止・
 * 置き換えの保存の失敗は `page.route` で通信の境界に注入する。
 * API の置き換えの契約（対象の制限・metadata の消去・ロールバック）は IT（message-replace.test.ts）が担う。
 */

const TITLE = '再生成テスト';
const PROMPT = 'こんにちは。一言で挨拶を返してください。';
/** 投入する旧応答。モデルがこの文字列をそのまま返すことはないため、置き換わったかの判定に使う */
const OLD_ANSWER = '再生成される前の古い回答です';

/**
 * 再生成ボタン。
 *
 * @param page - 対象のページ
 * @returns 再生成ボタンのロケーター
 */
function regenerateButton(page: Page) {
  // 会話タイトル（「再生成テスト」）のボタンにも部分一致するため、完全一致で探す
  return page.getByRole('button', { name: '再生成', exact: true });
}

/**
 * 質問と旧応答が 1 往復ある会話を投入する。
 *
 * @param request - Playwright の APIRequestContext
 * @returns 投入した会話の ID と旧応答の ID
 */
async function seedExchange(request: APIRequestContext) {
  const conv = await createConversation(request, TITLE);
  await createMessage(request, conv.id, 'user', PROMPT);
  const answer = await createMessage(request, conv.id, 'assistant', OLD_ANSWER);
  return { conversationId: conv.id, answerId: answer.id };
}

/**
 * トップを開き、投入した会話を選ぶ。
 *
 * @param page - 対象のページ
 */
async function openConversation(page: Page) {
  await page.goto('/');
  await page.getByText(TITLE).click();
  await expect(page.getByText(OLD_ANSWER)).toBeVisible();
}

/**
 * `/api/chat` の応答を遅らせ、その間に停止できるようにする。
 *
 * 遅らせた後に continue すると停止済みでもサーバーへ転送され、受け手のいない生成が Ollama を
 * 占有するため、転送せず fulfill で返す（停止済みなら fulfill は失敗するだけ。streaming-stop.spec.ts と同じ）。
 *
 * @param page - 対象のページ
 */
async function delayChat(page: Page) {
  await page.route('**/api/chat', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route
      .fulfill({ contentType: 'text/event-stream', body: '停止されなかった' })
      .catch(() => {});
  });
}

test.describe('メッセージ再生成', () => {
  test.setTimeout(180000);

  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('再生成すると旧応答が新しい応答に置き換わり、開き直しても新しい応答が表示される', async ({
      page,
      request,
    }) => {
      const { conversationId, answerId } = await seedExchange(request);
      await openConversation(page);

      await regenerateButton(page).click();

      await expect(page.getByText(OLD_ANSWER)).toBeHidden();
      await waitForResponseComplete(page);
      await expect(page.locator('.prose-nord')).toHaveCount(1);

      // 同じ ID の応答が置き換わり、件数は増えない
      await expect
        .poll(
          async () => {
            const messages = await fetchMessages(request, conversationId);
            const answer = messages.find((m) => m.id === answerId);
            return messages.length === 2 && answer?.content !== OLD_ANSWER;
          },
          { timeout: 10000 }
        )
        .toBe(true);

      // 開き直しても、DB から読み込んだ新しい応答が表示される
      await page.reload();
      await page.getByText(TITLE).click();
      await expect(page.locator('.prose-nord')).toHaveCount(1);
      await expect(page.getByText(OLD_ANSWER)).toHaveCount(0);
    });
  });

  test.describe('準正常系', () => {
    test('再生成ボタンは最後の応答にだけ出て、本文が出る前に停止すると旧応答に戻る', async ({
      page,
      request,
    }) => {
      const conv = await createConversation(request, TITLE);
      await createMessage(request, conv.id, 'user', '1つ目の質問');
      await createMessage(request, conv.id, 'assistant', '1つ目の回答');
      await createMessage(request, conv.id, 'user', PROMPT);
      await createMessage(request, conv.id, 'assistant', OLD_ANSWER);
      await delayChat(page);
      await openConversation(page);
      await expect(regenerateButton(page)).toHaveCount(1);

      await regenerateButton(page).click();

      // 最後の応答だけが作り直しの対象になる
      await expect(page.getByLabel('応答を生成中')).toBeVisible();
      await expect(page.getByText(OLD_ANSWER)).toBeHidden();
      await expect(page.getByText('1つ目の回答')).toBeVisible();

      await stopButton(page).click();

      await expect(page.getByText(OLD_ANSWER)).toBeVisible();
      await expect(page.getByText('生成を中断しました')).toHaveCount(0);
      const messages = await fetchMessages(request, conv.id);
      expect(messages.map((m) => m.content)).toEqual([
        '1つ目の質問',
        '1つ目の回答',
        PROMPT,
        OLD_ANSWER,
      ]);
    });

    test('生成中は再生成ボタンを押せず、停止して中断した応答は再生成できる', async ({
      page,
    }) => {
      await page.goto('/');
      await startLongAnswer(page);

      await expect(regenerateButton(page)).toBeDisabled();

      await stopButton(page).click();

      await expect(page.getByText('生成を中断しました')).toBeVisible();
      await expect(regenerateButton(page)).toBeEnabled();
    });
  });

  test.describe('異常系', () => {
    test('生成に失敗したらエラーを表示し、旧応答に戻す（DB は書き換えない）', async ({
      page,
      request,
    }) => {
      const { conversationId } = await seedExchange(request);
      await page.route('**/api/chat', (route) =>
        route.fulfill({
          status: 502,
          json: { error: 'テスト用の生成エラーです' },
        })
      );
      await openConversation(page);

      await regenerateButton(page).click();

      await expect(page.getByText('テスト用の生成エラーです')).toBeVisible();
      await expect(page.getByText(OLD_ANSWER)).toBeVisible();
      await expect(regenerateButton(page)).toBeEnabled();
      const messages = await fetchMessages(request, conversationId);
      expect(messages.map((m) => m.content)).toEqual([PROMPT, OLD_ANSWER]);
    });

    test('置き換えの保存に失敗したら保存失敗を表示し、再試行で保存できる', async ({
      page,
      request,
    }) => {
      const { conversationId, answerId } = await seedExchange(request);
      // 置き換え（PUT）だけを失敗させる
      const failReplace = async (route: Route) => {
        if (route.request().method() === 'PUT') {
          await route.fulfill({
            status: 500,
            json: { error: 'メッセージの保存に失敗しました' },
          });
          return;
        }
        await route.continue();
      };
      await page.route('**/api/conversations/*/messages/*', failReplace);
      await openConversation(page);

      await regenerateButton(page).click();
      await waitForResponseComplete(page);

      await expect(
        page.getByRole('status').filter({ hasText: '保存に失敗しました' })
      ).toBeVisible();
      // 保存されていない応答は再生成させない（先に再試行してもらう）
      await expect(regenerateButton(page)).toHaveCount(0);
      expect(
        (await fetchMessages(request, conversationId)).find(
          (m) => m.id === answerId
        )?.content
      ).toBe(OLD_ANSWER);

      await page.unroute('**/api/conversations/*/messages/*', failReplace);
      await page.getByRole('button', { name: '再試行' }).click();

      // dev オーバーレイの同じ文言（console.error）に一致しないよう、表示は role="status" に絞る
      await expect(
        page.getByRole('status').filter({ hasText: '保存に失敗しました' })
      ).toHaveCount(0);
      await expect(regenerateButton(page)).toBeVisible();
      await expect
        .poll(
          async () =>
            (await fetchMessages(request, conversationId)).find(
              (m) => m.id === answerId
            )?.content,
          { timeout: 10000 }
        )
        .not.toBe(OLD_ANSWER);
    });
  });
});
