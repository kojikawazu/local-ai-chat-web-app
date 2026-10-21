import type { Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import {
  cleanupAllConversations,
  createConversation,
  createMessage,
  fetchConversations,
  fetchMessages,
  fillTextarea,
  sendMessage,
} from './helpers/test-data';

/**
 * 応答の生成停止（Stop ボタン・Escape）の E2E（#8）。
 *
 * 実際の Ollama に長い応答を生成させ、その途中で止める。止めるのは本文が出始めてからに
 * する（最初の文字の前に止めるケースは、`page.route` で応答を遅らせて決定的に作る）。
 * 停止した応答の保存は API で確かめ、開き直したときの表示は投入した会話で確かめる
 * （送信で作られた会話はタイトルの自動生成で名前が変わり、開き直す操作が不安定になるため）。
 * サーバー側で Ollama の生成が止まることは IT（chat-stop.test.ts）が担う。
 */

/**
 * 止める前に終わらないよう、十分に長い応答を求める。qwen2.5:0.5b で 300 トークン以上の応答に
 * なる割合が最も高かった（15 回中 14 回。「1 から 500 まで数えて」は 7 回で、短く省略しがち）
 */
const LONG_PROMPT =
  '日本の歴史について、縄文時代から令和まで、各時代を詳しく、できるだけ長く説明してください。';

/** 応答が短く終わって止められなかったときに送り直す上限（15 回に 1 回の短い応答を吸収する） */
const MAX_SEND_ATTEMPTS = 3;

/** 生成中に出る停止ボタン */
function stopButton(page: Page) {
  return page.getByRole('button', { name: '生成を停止' });
}

/** 表示中の最後の応答の本文（Markdown の描画領域） */
function lastAnswer(page: Page) {
  return page.locator('.prose-nord').last();
}

/**
 * 長い応答を生成させ、本文が出始めて生成中のところまで進める。
 *
 * 軽量モデルはまれに短く答えて、止める前に生成を終える。その場合は同じ会話で送り直す
 * （モデルの出力の長さはテストから制御できないため）。
 *
 * @param page - 対象のページ
 * @throws {Error} {@link MAX_SEND_ATTEMPTS} 回送っても、生成中の状態にならなかった場合
 */
async function startLongAnswer(page: Page) {
  await page.goto('/');
  const answers = page.locator('.prose-nord');
  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
    const before = await answers.count();
    await sendMessage(page, LONG_PROMPT);
    // 本文の描画領域は最初の文字が届いた時点で現れる
    await expect(answers).toHaveCount(before + 1, { timeout: 120000 });
    if (await stopButton(page).isVisible()) return;
  }
  throw new Error(`${MAX_SEND_ATTEMPTS} 回送っても、止める前に応答が終わった`);
}

/**
 * 停止後、本文が増えなくなったことを確かめる。
 *
 * @param page - 対象のページ
 */
async function expectAnswerStopped(page: Page) {
  const before = await lastAnswer(page).textContent();
  await page.waitForTimeout(1500);
  expect(await lastAnswer(page).textContent()).toBe(before);
}

test.describe('ストリーミング停止', () => {
  test.setTimeout(180000);

  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('停止ボタンで生成が止まり、途中までの本文が中断マーク付きで表示・保存される', async ({
      page,
      request,
    }) => {
      await startLongAnswer(page);

      await stopButton(page).click();

      await expect(page.getByText('生成を中断しました')).toBeVisible();
      await expect(stopButton(page)).toBeHidden();
      await expect(page.locator('button[type="submit"]')).toBeVisible();
      await expectAnswerStopped(page);

      // 途中までの本文が中断マーク付きで保存されている
      await expect
        .poll(
          async () => {
            const [conv] = await fetchConversations(request);
            if (!conv) return null;
            const messages = await fetchMessages(request, conv.id);
            // 送り直した場合は、先に短く終わった応答も保存されている
            return messages.some(
              (m) => m.role === 'assistant' && m.metadata?.interrupted === true
            );
          },
          { timeout: 10000 }
        )
        .toBe(true);
    });

    test('中断した応答を開き直すと「生成を中断しました」が表示される', async ({
      page,
      request,
    }) => {
      const conv = await createConversation(request, '中断した会話');
      await createMessage(request, conv.id, 'user', LONG_PROMPT);
      await createMessage(request, conv.id, 'assistant', '1\n2\n3', {
        interrupted: true,
      });

      await page.goto('/');
      await page.getByText('中断した会話').click();

      await expect(page.getByText('生成を中断しました')).toBeVisible();
    });
  });

  test.describe('準正常系', () => {
    test('生成中に入力欄で Escape を押すと停止する', async ({ page }) => {
      await startLongAnswer(page);

      await page.locator('textarea').press('Escape');

      await expect(page.getByText('生成を中断しました')).toBeVisible();
      await expectAnswerStopped(page);
    });

    test('本文が出る前に停止すると応答を残さず、続けて送信できる', async ({
      page,
    }) => {
      // モデルの読み込み待ちを再現するため、/api/chat の応答を遅らせる（その間に停止する）。
      // 遅らせた後に continue するとページが停止済みでもサーバーへ転送され、受け手のいない
      // 長い生成が Ollama を占有して後続のテストを待たせる。そのため転送せず fulfill で返す
      // （停止済みなら fulfill は失敗するだけで、サーバーには何も届かない）
      await page.route('**/api/chat', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await route
          .fulfill({
            contentType: 'text/event-stream',
            body: '停止されなかった',
          })
          .catch(() => {});
      });
      await page.goto('/');
      await sendMessage(page, LONG_PROMPT);
      await expect(page.getByLabel('応答を生成中')).toBeVisible();

      await stopButton(page).click();

      await expect(page.getByLabel('応答を生成中')).toBeHidden();
      await expect(page.locator('.prose-nord')).toHaveCount(0);
      await expect(page.getByText('生成を中断しました')).toHaveCount(0);
      // 質問は残り、次の送信ができる（質問はサイドバーの会話タイトルにも出るためチャット欄に絞る）
      await expect(page.locator('main').getByText(LONG_PROMPT)).toBeVisible();
      await fillTextarea(page, '次の質問');
      await expect(page.locator('button[type="submit"]')).toBeEnabled();
    });
  });

  test.describe('異常系', () => {
    test('途中までの本文の保存に失敗したら、保存失敗と再試行ボタンを表示する', async ({
      page,
    }) => {
      // 応答（assistant）の保存だけを失敗させる。質問の保存は通す
      await page.route('**/api/conversations/*/messages', async (route) => {
        const req = route.request();
        if (
          req.method() === 'POST' &&
          req.postDataJSON()?.role === 'assistant'
        ) {
          await route.fulfill({
            status: 500,
            json: { error: 'メッセージの保存に失敗しました' },
          });
          return;
        }
        await route.continue();
      });
      await startLongAnswer(page);

      await stopButton(page).click();

      await expect(page.getByText('生成を中断しました')).toBeVisible();
      // 送り直した場合は先に短く終わった応答も保存に失敗しているため、最後（停止した応答）を見る
      await expect(
        page
          .getByRole('status')
          .filter({ hasText: '保存に失敗しました' })
          .last()
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: '再試行' }).last()
      ).toBeVisible();
    });
  });
});
