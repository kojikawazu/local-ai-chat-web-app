import type { Route } from '@playwright/test';
import { test, expect } from '@playwright/test';
import {
  cleanupAllConversations,
  createConversation,
  createMessage,
  fetchConversations,
  fetchMessages,
  sendMessage,
} from './helpers/test-data';

/** メッセージ保存 API のパス（会話 ID 部分はワイルドカード）。 */
const MESSAGES_API = '**/api/conversations/*/messages';

/**
 * メッセージ保存 API の POST を、指定 role のときだけ 500 にする route ハンドラを作る。
 *
 * 実 DB を安定して壊せないため、境界の障害注入（`page.route`）で保存失敗を再現する
 * （testing.md「エラーハンドリングの層分担」の唯一の許容例外）。取得（GET）や
 * 対象外 role の保存は実バックエンドへ素通しする。
 *
 * @param role - 保存を失敗させるメッセージの役割
 * @returns `page.route` / `page.unroute` に渡すハンドラ
 */
function failSaveOf(role: 'user' | 'assistant') {
  return (route: Route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postDataJSON()?.role === role) {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'メッセージの保存に失敗しました' }),
      });
    }
    return route.continue();
  };
}

test.describe('会話管理', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('新規会話を作成してメッセージを送信できる', async ({
      page,
      request,
    }) => {
      await cleanupAllConversations(request);
      await page.goto('/');

      // メッセージを送信（自動的に会話が作成される）
      await sendMessage(page, '新規会話テスト');

      // ユーザーメッセージが表示される
      await expect(page.getByText('新規会話テスト').first()).toBeVisible({
        timeout: 10000,
      });

      // サイドバーに会話が追加される
      await expect(
        page.locator('nav').locator('[class*="group"]').first()
      ).toBeVisible({ timeout: 10000 });
    });

    test('会話を切り替えると対応するメッセージが表示される', async ({
      page,
      request,
    }) => {
      await cleanupAllConversations(request);

      const conv1 = await createConversation(request, '会話Alpha');
      const conv2 = await createConversation(request, '会話Beta');
      await createMessage(request, conv1.id, 'user', 'Alphaのメッセージ');
      await createMessage(request, conv2.id, 'user', 'Betaのメッセージ');

      await page.goto('/');

      await page.getByText('会話Alpha').click();
      await expect(page.getByText('Alphaのメッセージ')).toBeVisible({
        timeout: 10000,
      });

      await page.getByText('会話Beta').click();
      await expect(page.getByText('Betaのメッセージ')).toBeVisible({
        timeout: 10000,
      });
      // Alphaのメッセージは表示されない
      await expect(page.getByText('Alphaのメッセージ')).toHaveCount(0);
    });

    test('会話を削除するとメッセージも消える', async ({ page, request }) => {
      await cleanupAllConversations(request);

      const conv = await createConversation(request, '削除テスト会話');
      await createMessage(request, conv.id, 'user', '削除されるメッセージ');

      await page.goto('/');

      // 会話を選択してメッセージ確認
      await page.getByText('削除テスト会話').click();
      await expect(page.getByText('削除されるメッセージ')).toBeVisible({
        timeout: 10000,
      });

      // 会話を削除
      const convRow = page
        .locator('[class*="group"]', { hasText: '削除テスト会話' })
        .first();
      await convRow.hover();
      await convRow.locator('button').nth(1).click();

      // 会話とメッセージが消える
      await expect(page.getByText('削除テスト会話')).toHaveCount(0, {
        timeout: 10000,
      });
      await expect(page.getByText('削除されるメッセージ')).toHaveCount(0);
    });

    test('ページリロード後も会話履歴が保持される', async ({
      page,
      request,
    }) => {
      await cleanupAllConversations(request);

      const conv = await createConversation(request, '永続化テスト');
      await createMessage(request, conv.id, 'user', '永続化メッセージ');
      await createMessage(request, conv.id, 'assistant', '永続化応答');

      await page.goto('/');
      await page.getByText('永続化テスト').click();
      await expect(page.getByText('永続化メッセージ')).toBeVisible({
        timeout: 10000,
      });

      // リロード
      await page.reload();

      // 会話一覧に残っている
      await expect(page.getByText('永続化テスト')).toBeVisible({
        timeout: 10000,
      });

      // 会話を再度選択してメッセージが残っている
      await page.getByText('永続化テスト').click();
      await expect(page.getByText('永続化メッセージ')).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByText('永続化応答')).toBeVisible();
    });
  });

  test.describe('準正常系', () => {
    test('長文メッセージ（10,000文字）がDBに保存・表示される', async ({
      request,
      page,
    }) => {
      await cleanupAllConversations(request);

      const longText = 'A'.repeat(10000);
      const conv = await createConversation(request, '長文テスト');
      await createMessage(request, conv.id, 'user', longText);

      // DB側で保存されていることを確認
      const messages = await fetchMessages(request, conv.id);
      expect(messages.length).toBe(1);
      expect(messages[0].content.length).toBe(10000);

      // UIでも表示される
      await page.goto('/');
      await page.getByText('長文テスト').click();

      const userMessage = page.locator('[class*="bg-nord-frost-2"]').first();
      await expect(userMessage).toBeVisible({ timeout: 10000 });
    });

    test('会話タイトルが未指定の場合、デフォルトタイトルが使われる', async ({
      request,
    }) => {
      const conv = await createConversation(request);
      expect(conv.title).toBe('テスト会話');
    });
  });

  test.describe('異常系', () => {
    test('削除済み会話のメッセージ取得でエラーが返る', async ({ request }) => {
      const conv = await createConversation(request, '削除対象');
      const convId = conv.id;

      // 削除
      await request.delete(`http://localhost:3000/api/conversations/${convId}`);

      // メッセージ取得を試みる
      const res = await request.get(
        `http://localhost:3000/api/conversations/${convId}/messages`
      );
      expect(res.status()).toBe(404);
    });

    test('存在しないUUIDで会話削除すると 404 が返る', async ({ request }) => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await request.delete(
        `http://localhost:3000/api/conversations/${fakeId}`
      );
      expect(res.status()).toBe(404);
    });

    test('ユーザーメッセージの保存に失敗すると送信失敗を表示し LLM を呼ばない。再送で保存・生成が進む', async ({
      page,
      request,
    }) => {
      test.setTimeout(60000);
      await cleanupAllConversations(request);
      const failUserSave = failSaveOf('user');
      await page.route(MESSAGES_API, failUserSave);
      let chatRequested = false;
      page.on('request', (req) => {
        if (req.url().endsWith('/api/chat')) chatRequested = true;
      });

      await page.goto('/');
      await sendMessage(page, '保存失敗テスト');

      // 成功表示にせず、送信失敗を明示する
      await expect(
        page.getByRole('status').filter({ hasText: '送信に失敗しました' })
      ).toBeVisible({ timeout: 10000 });
      // 未保存の質問に対して LLM を呼ばない（DB に回答だけが残る不整合を防ぐ）
      expect(chatRequested).toBe(false);

      // 保存 API を復旧して再送すると、保存されたうえで応答生成が始まる
      await page.unroute(MESSAGES_API, failUserSave);
      const chatRequest = page.waitForRequest('**/api/chat');
      await page.getByRole('button', { name: '再送' }).click();
      await chatRequest;
      // dev オーバーレイの同じ文言に一致させないため、アプリの表示に絞る（下の AI 応答のテストと同じ）
      await expect(
        page.getByRole('status').filter({ hasText: '送信に失敗しました' })
      ).toHaveCount(0);

      const [conv] = await fetchConversations(request);
      const messages = await fetchMessages(request, conv.id);
      expect(messages[0]).toMatchObject({
        role: 'user',
        content: '保存失敗テスト',
      });
    });

    test('AI応答の保存に失敗すると応答を残したまま保存失敗を表示し、再試行で保存される', async ({
      page,
      request,
    }) => {
      test.skip(
        !!process.env.CI,
        'CI環境(CPU only)ではストリーミング完了まで時間がかかりすぎるためスキップ'
      );
      test.setTimeout(180000);
      await cleanupAllConversations(request);
      const failAssistantSave = failSaveOf('assistant');
      await page.route(MESSAGES_API, failAssistantSave);

      await page.goto('/');
      await sendMessage(page, 'Say hi');

      // ストリーミング完了後、応答は消さずに保存失敗を表示する
      await expect(
        page.getByRole('status').filter({ hasText: '保存に失敗しました' })
      ).toBeVisible({ timeout: 150000 });
      const aiMessage = page.locator('[class*="bg-nord-2"]').first();
      const displayed = (await aiMessage.textContent()) ?? '';
      expect(displayed.length).toBeGreaterThan(0);

      // 保存 API を復旧して再試行すると、失敗表示が消えて DB に保存される。
      // 画面全体の getByText だと、保存 API の失敗を表示する Next.js の dev オーバーレイ
      // （エラーメッセージに同じ文言を含む）にも一致して 0 件にならないため、アプリの表示に絞る
      await page.unroute(MESSAGES_API, failAssistantSave);
      await page.getByRole('button', { name: '再試行' }).click();
      await expect(
        page.getByRole('status').filter({ hasText: '保存に失敗しました' })
      ).toHaveCount(0, { timeout: 10000 });

      const [conv] = await fetchConversations(request);
      const messages = await fetchMessages(request, conv.id);
      expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
      expect(messages[1].content.length).toBeGreaterThan(0);
    });
  });
});
