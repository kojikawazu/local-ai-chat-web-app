import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import {
  cleanupAllConversations,
  createConversation,
  createMessage,
  deleteConversation,
  sendMessage,
  waitForResponseComplete,
} from './helpers/test-data';

/**
 * 会話の分岐の E2E（#29。`docs/22-conversation-fork.md`）。
 *
 * 会話と応答は API で用意する（モデルの応答に依存せず、軽量モデル・CI でも動く）。コピーの中身（順序・時刻・添付画像・
 * ツールの画面の ID）・400 / 404 の契約は IT（conversation-fork.test.ts）、タイトル・ID の書き換え・ボディの検証は
 * UT（conversation-fork.test.ts）が担い、ここでは画面の操作と表示（ボタン・新しい会話が開く・サイドバーの印・
 * ヘッダーの分岐元のリンク・失敗のお知らせ）を見る。
 * 分岐した会話で続けて質問する 1 件は実際の生成が要るため、CI でスキップする。
 */

/**
 * 2 往復の会話を API で作る。
 *
 * @param request - API のリクエストのコンテキスト
 * @param title - 会話のタイトル
 * @returns 会話の ID と、4 件のメッセージの ID（古い順）
 */
async function createTwoExchanges(request: APIRequestContext, title: string) {
  const conversation = await createConversation(request, title);
  const q1 = await createMessage(
    request,
    conversation.id,
    'user',
    '最初の質問'
  );
  const a1 = await createMessage(
    request,
    conversation.id,
    'assistant',
    '最初の応答'
  );
  const q2 = await createMessage(request, conversation.id, 'user', '次の質問');
  const a2 = await createMessage(
    request,
    conversation.id,
    'assistant',
    '次の応答'
  );
  return {
    conversationId: conversation.id,
    messageIds: [q1.id, a1.id, q2.id, a2.id],
  };
}

/**
 * デスクトップのサイドバーで会話を開く。
 *
 * @param page - 対象のページ
 * @param title - 会話のタイトル
 */
async function openConversation(page: Page, title: string) {
  await page
    .locator('aside')
    .getByRole('button', { name: title, exact: true })
    .click();
}

/**
 * メッセージの要素（本文・操作の行を含む）。
 *
 * @param page - 対象のページ
 * @param messageId - メッセージの ID
 * @returns メッセージの要素のロケーター
 */
function messageOf(page: Page, messageId: string) {
  return page.locator(`[data-message-id="${messageId}"]`);
}

/**
 * サイドバーの分岐した会話の行。分岐の印のアイコンの名前（「分岐した会話」）がタイトルの前に付く。
 *
 * @param page - 対象のページ
 * @param title - 会話のタイトル
 * @returns 行のボタンのロケーター
 */
function forkedItem(page: Page, title: string) {
  return page
    .locator('aside')
    .getByRole('button', { name: `分岐した会話 ${title}`, exact: true });
}

test.describe('会話の分岐', () => {
  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('途中の応答から分岐すると、そこまでのやり取りを持った新しい会話が開く', async ({
      page,
    }) => {
      const { messageIds } = await createTwoExchanges(
        page.request,
        '旅行の計画'
      );
      await page.goto('/');
      await openConversation(page, '旅行の計画');

      await messageOf(page, messageIds[1])
        .getByRole('button', { name: 'ここから分岐' })
        .click();

      // 新しい会話が選ばれ、分岐した応答までが出る（後のやり取りは出ない）
      await expect(forkedItem(page, '旅行の計画（分岐）')).toHaveAttribute(
        'aria-current',
        'page'
      );
      const main = page.locator('main');
      await expect(main.getByText('最初の応答')).toBeVisible();
      await expect(main.getByText('次の応答')).toHaveCount(0);
      // 続けて打てるように入力欄にフォーカスする
      await expect(page.locator('textarea')).toBeFocused();
      // 元の会話は印なしで残る
      await expect(
        page.locator('aside').getByRole('button', {
          name: '旅行の計画',
          exact: true,
        })
      ).toBeVisible();
    });

    test('ヘッダーの分岐元のリンクで、元の会話のその応答へ移る', async ({
      page,
      request,
    }) => {
      // 分岐する応答を長い会話の先頭に置く（会話を開いた直後の一番下へのスクロールでは見えない位置）
      const source = await createConversation(request, '長い会話');
      await createMessage(request, source.id, 'user', '最初の質問');
      const first = await createMessage(
        request,
        source.id,
        'assistant',
        '分岐する応答'
      );
      for (let i = 0; i < 12; i++) {
        await createMessage(request, source.id, 'user', `続きの質問 ${i}`);
        await createMessage(
          request,
          source.id,
          'assistant',
          `続きの応答 ${i}\n\n${'長い段落。'.repeat(40)}`
        );
      }
      const res = await request.post(
        `http://localhost:3000/api/conversations/${source.id}/fork`,
        { data: { messageId: first.id } }
      );
      expect(res.status()).toBe(201);
      await page.goto('/');
      await forkedItem(page, '長い会話（分岐）').click();

      await page
        .getByRole('button', { name: '分岐元の会話を開く: 長い会話' })
        .click();

      await expect(
        page
          .locator('aside')
          .getByRole('button', { name: '長い会話', exact: true })
      ).toHaveAttribute('aria-current', 'page');
      const message = messageOf(page, first.id);
      await expect(message).toBeInViewport();
      await expect(message).toHaveAttribute('data-focused', 'true');
      // 元の会話は分岐していないため、リンクを出さない
      await expect(
        page.getByRole('button', { name: /分岐元の会話を開く/ })
      ).toHaveCount(0);
    });

    test('分岐した会話で続けて質問すると、分岐した応答までを履歴として送る', async ({
      page,
    }) => {
      test.skip(
        !!process.env.CI,
        'CI環境(CPU only)ではストリーミング完了まで時間がかかりすぎるためスキップ'
      );
      const { messageIds } = await createTwoExchanges(
        page.request,
        '続ける会話'
      );
      await page.goto('/');
      await openConversation(page, '続ける会話');
      await messageOf(page, messageIds[1])
        .getByRole('button', { name: 'ここから分岐' })
        .click();
      await expect(page.locator('main').getByText('次の応答')).toHaveCount(0);

      const chatRequest = page.waitForRequest('**/api/chat');
      await sendMessage(page, 'Say hi');
      const body = (await chatRequest).postDataJSON() as {
        conversationHistory: { role: string; content: string }[];
      };
      expect(body.conversationHistory).toEqual([
        { role: 'user', content: '最初の質問' },
        { role: 'assistant', content: '最初の応答' },
      ]);
      await waitForResponseComplete(page);
    });
  });

  test.describe('準正常系', () => {
    test('分岐元の会話を消すと、分岐した会話は残り、分岐元のリンクが消える', async ({
      page,
      request,
    }) => {
      const { conversationId, messageIds } = await createTwoExchanges(
        request,
        '消す会話'
      );
      await request.post(
        `http://localhost:3000/api/conversations/${conversationId}/fork`,
        { data: { messageId: messageIds[1] } }
      );
      await deleteConversation(request, conversationId);
      await page.goto('/');

      // 分岐元が消えたため、印の無い普通の会話として並ぶ
      await openConversation(page, '消す会話（分岐）');
      await expect(page.locator('main').getByText('最初の応答')).toBeVisible();
      await expect(
        page.getByRole('button', { name: /分岐元の会話を開く/ })
      ).toHaveCount(0);
    });

    test('user のメッセージには分岐のボタンを出さない', async ({ page }) => {
      const { messageIds } = await createTwoExchanges(
        page.request,
        '質問の会話'
      );
      await page.goto('/');
      await openConversation(page, '質問の会話');

      await expect(
        messageOf(page, messageIds[1]).getByRole('button', {
          name: 'ここから分岐',
        })
      ).toBeVisible();
      await expect(
        messageOf(page, messageIds[0]).getByRole('button', {
          name: 'ここから分岐',
        })
      ).toHaveCount(0);
    });
  });

  test.describe('異常系', () => {
    test('分岐の API が失敗するとお知らせを出し、元の会話に留まる', async ({
      page,
    }) => {
      const { messageIds } = await createTwoExchanges(
        page.request,
        '失敗の会話'
      );
      await page.route('**/api/conversations/*/fork', (route) =>
        route.fulfill({
          status: 500,
          json: { error: '会話の分岐に失敗しました' },
        })
      );
      await page.goto('/');
      await openConversation(page, '失敗の会話');

      const button = messageOf(page, messageIds[1]).getByRole('button', {
        name: 'ここから分岐',
      });
      await button.click();

      await expect(
        page.locator('main').getByText('会話を分岐できませんでした')
      ).toBeVisible();
      await expect(
        page
          .locator('aside')
          .getByRole('button', { name: '失敗の会話', exact: true })
      ).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('aside').getByText('（分岐）')).toHaveCount(0);
      // 失敗の後も押し直せる
      await expect(button).toBeEnabled();

      // 別の会話へ移ったら、お知らせは出さない
      await page
        .locator('aside')
        .getByRole('button', { name: 'New Conversation' })
        .click();
      await expect(
        page.locator('main').getByText('会話を分岐できませんでした')
      ).toHaveCount(0);
    });
  });
});
