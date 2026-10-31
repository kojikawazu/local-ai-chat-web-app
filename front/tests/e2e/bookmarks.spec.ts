import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import {
  cleanupAllConversations,
  createConversation,
  createMessage,
  sendMessage,
  waitForResponseComplete,
} from './helpers/test-data';

/**
 * 応答のブックマークの E2E（#30。`docs/21-bookmarks.md`）。
 *
 * 会話と応答は API で用意する（モデルの応答に依存せず、軽量モデル・CI でも動く）。検索の条件・並び・ページ分け・
 * 再生成での削除の契約は IT（bookmarks.test.ts）、抜粋・ボディの検証・表示への反映は UT（bookmark.test.ts）が担い、
 * ここでは画面の操作と表示（ボタン・一覧のダイアログ・元の応答へ移る）を見る。
 * 実際の生成が要る 1 件（保存に失敗した応答にボタンを出さない）は CI でスキップする。
 */

const BOOKMARKS_API = '/api/bookmarks';

/**
 * 会話と、質問・応答の 2 件のメッセージを API で作る。
 *
 * @param request - API のリクエストのコンテキスト
 * @param title - 会話のタイトル
 * @param answer - 応答の本文
 * @returns 会話の ID と応答の ID
 */
async function createExchange(
  request: APIRequestContext,
  title: string,
  answer: string
) {
  const conversation = await createConversation(request, title);
  await createMessage(request, conversation.id, 'user', `${title}の質問`);
  const reply = await createMessage(
    request,
    conversation.id,
    'assistant',
    answer
  );
  return { conversationId: conversation.id, answerId: reply.id };
}

/**
 * 応答にブックマークを API で付ける。
 *
 * @param request - API のリクエストのコンテキスト
 * @param messageId - 応答の ID
 * @returns 付けたブックマークの ID
 */
async function bookmark(request: APIRequestContext, messageId: string) {
  const res = await request.post(`http://localhost:3000${BOOKMARKS_API}`, {
    data: { messageId },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: string }).id;
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
 * ブックマークの一覧のダイアログを開く。
 *
 * @param page - 対象のページ
 * @returns ダイアログのロケーター
 */
async function openBookmarks(page: Page) {
  await page
    .locator('aside')
    .getByRole('button', { name: 'ブックマークを開く' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'ブックマーク' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * メッセージの要素（応答の本文・操作の行を含む）。
 *
 * @param page - 対象のページ
 * @param messageId - メッセージの ID
 * @returns メッセージの要素のロケーター
 */
function messageOf(page: Page, messageId: string) {
  return page.locator(`[data-message-id="${messageId}"]`);
}

test.describe('応答のブックマーク', () => {
  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('応答の下のボタンで付け、読み直しても残り、もう一度押すと外れる', async ({
      page,
    }) => {
      const { answerId } = await createExchange(
        page.request,
        'ボタンの会話',
        'ボタンで付ける応答'
      );
      await page.goto('/');
      await openConversation(page, 'ボタンの会話');

      const message = messageOf(page, answerId);
      await message.getByRole('button', { name: 'ブックマークする' }).click();
      const added = message.getByRole('button', { name: 'ブックマークを外す' });
      await expect(added).toHaveAttribute('aria-pressed', 'true');
      // 押した直後は返事を待つ間も表示が切り替わる。押せるようになる＝保存が終わった
      await expect(added).toBeEnabled();

      await page.reload();
      await openConversation(page, 'ボタンの会話');
      const pressed = messageOf(page, answerId).getByRole('button', {
        name: 'ブックマークを外す',
      });
      await expect(pressed).toHaveAttribute('aria-pressed', 'true');

      await pressed.click();
      const removed = messageOf(page, answerId).getByRole('button', {
        name: 'ブックマークする',
      });
      await expect(removed).toHaveAttribute('aria-pressed', 'false');
      await expect(removed).toBeEnabled();
      const res = await page.request.get(
        `http://localhost:3000${BOOKMARKS_API}`
      );
      expect((await res.json()).bookmarks).toEqual([]);
    });

    test('一覧に新しい順で出て、キーワードで絞り込むと一致箇所が強調される', async ({
      page,
      request,
    }) => {
      const older = await createExchange(
        request,
        'Docker の会話',
        'compose の手順'
      );
      const newer = await createExchange(
        request,
        'React の会話',
        'フックの説明'
      );
      await bookmark(request, older.answerId);
      await bookmark(request, newer.answerId);
      await page.goto('/');

      const dialog = await openBookmarks(page);
      const list = dialog.getByRole('list', { name: 'ブックマークの一覧' });
      await expect(list.getByRole('listitem')).toHaveCount(2);
      await expect(list.getByRole('listitem').first()).toHaveAccessibleName(
        'React の会話'
      );

      await dialog
        .getByLabel('ブックマークを検索')
        .pressSequentially('compose', {
          delay: 10,
        });
      await expect(list.getByRole('listitem')).toHaveCount(1);
      const item = list.getByRole('listitem', { name: 'Docker の会話' });
      await expect(item.locator('mark')).toHaveText('compose');
    });

    test('メモを書いて保存すると一覧に出て、メモの語でも見つかる', async ({
      page,
      request,
    }) => {
      const { answerId } = await createExchange(
        request,
        'メモの会話',
        '応答の本文'
      );
      await bookmark(request, answerId);
      await page.goto('/');

      const dialog = await openBookmarks(page);
      const item = dialog.getByRole('listitem', { name: 'メモの会話' });
      await item.getByRole('button', { name: 'メモ', exact: true }).click();
      await item
        .getByLabel('メモ')
        .pressSequentially('あとで読む', { delay: 10 });
      await item.getByRole('button', { name: '保存' }).click();
      await expect(item.getByText('あとで読む')).toBeVisible();

      await dialog
        .getByLabel('ブックマークを検索')
        .pressSequentially('あとで', {
          delay: 10,
        });
      await expect(
        dialog.getByRole('listitem', { name: 'メモの会話' }).locator('mark')
      ).toHaveText('あとで');
    });

    test('一覧から別の会話の応答へ移ると、その会話が開き、応答が画面に入って枠で示される', async ({
      page,
      request,
    }) => {
      // 移る先の応答を長い会話の先頭に置く（会話を開いた直後の一番下へのスクロールでは見えない位置）
      const target = await createConversation(request, '長い会話');
      await createMessage(request, target.id, 'user', '最初の質問');
      const first = await createMessage(
        request,
        target.id,
        'assistant',
        '読み返したい最初の応答'
      );
      for (let i = 0; i < 12; i++) {
        await createMessage(request, target.id, 'user', `続きの質問 ${i}`);
        await createMessage(
          request,
          target.id,
          'assistant',
          `続きの応答 ${i}\n\n${'長い段落。'.repeat(40)}`
        );
      }
      await bookmark(request, first.id);
      await createExchange(request, '別の会話', '今開いている応答');
      await page.goto('/');
      await openConversation(page, '別の会話');

      const dialog = await openBookmarks(page);
      await dialog
        .getByRole('listitem', { name: '長い会話' })
        .getByRole('button', {
          name: /長い会話/,
        })
        .click();

      await expect(dialog).toBeHidden();
      const message = messageOf(page, first.id);
      await expect(message).toBeInViewport();
      await expect(message).toHaveAttribute('data-focused', 'true');
      await expect(
        page
          .locator('aside')
          .getByRole('button', { name: '長い会話', exact: true })
      ).toHaveAttribute('aria-current', 'page');
      // 枠は短く出して消す
      await expect(message).not.toHaveAttribute('data-focused', 'true', {
        timeout: 5000,
      });
      // 移る先を忘れた後も、一番下へ戻さない（移る先が消えたことで一番下へのスクロールが走り直した不具合の回帰）
      await expect(message).toBeInViewport();
    });
  });

  test.describe('準正常系', () => {
    test('一覧で外すと 2 段階で確かめ、開いている会話の印も消える', async ({
      page,
      request,
    }) => {
      const { answerId } = await createExchange(
        request,
        '外す会話',
        '外す応答'
      );
      await bookmark(request, answerId);
      await page.goto('/');
      await openConversation(page, '外す会話');
      await expect(
        messageOf(page, answerId).getByRole('button', {
          name: 'ブックマークを外す',
        })
      ).toBeVisible();

      const dialog = await openBookmarks(page);
      const item = dialog.getByRole('listitem', { name: '外す会話' });
      await item.getByRole('button', { name: '外す', exact: true }).click();
      await item.getByRole('button', { name: 'やめる' }).click();
      await expect(item).toBeVisible();

      await item.getByRole('button', { name: '外す', exact: true }).click();
      await item.getByRole('button', { name: 'はい、外す' }).click();
      await expect(item).toHaveCount(0);
      await expect(
        dialog.getByText('ブックマークはまだありません', { exact: false })
      ).toBeVisible();

      await dialog.getByRole('button', { name: '閉じる' }).last().click();
      await expect(
        messageOf(page, answerId).getByRole('button', {
          name: 'ブックマークする',
        })
      ).toBeVisible();
    });

    test('一致するブックマークが無ければその旨を出し、検索をやめると全件に戻る', async ({
      page,
      request,
    }) => {
      const { answerId } = await createExchange(request, '雑談', '応答');
      await bookmark(request, answerId);
      await page.goto('/');

      const dialog = await openBookmarks(page);
      await dialog
        .getByLabel('ブックマークを検索')
        .pressSequentially('存在しない語', {
          delay: 10,
        });
      await expect(
        dialog.getByText('一致するブックマークは見つかりませんでした')
      ).toBeVisible();

      await dialog.getByRole('button', { name: '検索をやめる' }).click();
      await expect(
        dialog.getByRole('listitem', { name: '雑談' })
      ).toBeVisible();
    });

    test('保存に失敗した応答にはボタンを出さない', async ({ page }) => {
      test.skip(
        !!process.env.CI,
        'CI環境(CPU only)ではストリーミング完了まで時間がかかりすぎるためスキップ'
      );
      // 応答の保存だけを失敗させる（質問は保存させ、生成まで進める）
      await page.route('**/api/conversations/*/messages', async (route) => {
        const body = route.request().postDataJSON() as { role?: string } | null;
        if (route.request().method() === 'POST' && body?.role === 'assistant') {
          await route.fulfill({ status: 500, json: { error: '保存の失敗' } });
          return;
        }
        await route.continue();
      });
      await page.goto('/');
      await sendMessage(page, 'Say hi');
      await waitForResponseComplete(page);

      const failed = page.locator('main [data-message-id]').filter({
        hasText: '保存に失敗しました',
      });
      await expect(failed).toBeVisible();
      await expect(
        failed.getByRole('button', { name: 'ブックマークする' })
      ).toHaveCount(0);
    });
  });

  test.describe('異常系', () => {
    test('付ける API が失敗すると表示を戻し、失敗を出す', async ({
      page,
      request,
    }) => {
      const { answerId } = await createExchange(request, '失敗の会話', '応答');
      await page.route(`**${BOOKMARKS_API}`, (route) =>
        route.fulfill({
          status: 500,
          json: { error: 'ブックマークに失敗しました' },
        })
      );
      await page.goto('/');
      await openConversation(page, '失敗の会話');

      const message = messageOf(page, answerId);
      await message.getByRole('button', { name: 'ブックマークする' }).click();
      await expect(
        message.getByText('ブックマークの更新に失敗しました')
      ).toBeVisible();
      await expect(
        message.getByRole('button', { name: 'ブックマークする' })
      ).toHaveAttribute('aria-pressed', 'false');
    });

    test('一覧の API が失敗するとダイアログにエラーを出す', async ({
      page,
    }) => {
      await page.route(`**${BOOKMARKS_API}?*`, (route) =>
        route.fulfill({
          status: 500,
          json: { error: 'ブックマークの取得に失敗しました' },
        })
      );
      await page.goto('/');

      const dialog = await openBookmarks(page);
      await expect(
        dialog.getByText('ブックマークの取得に失敗しました')
      ).toBeVisible();
      await expect(
        dialog.getByRole('list', { name: 'ブックマークの一覧' })
      ).toHaveCount(0);
    });
  });
});
