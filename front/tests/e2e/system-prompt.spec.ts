import type { Page, Request } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { stopButton } from './helpers/long-answer';
import {
  cleanupAllConversations,
  createConversation,
  fetchConversations,
  sendMessage,
  waitForResponseComplete,
} from './helpers/test-data';

/**
 * 会話の役割（システムプロンプト）の E2E（#10）。
 *
 * 役割が送信に付くことは、ブラウザが送る `/api/chat` のリクエストを観察して確かめる（応答は実際の
 * Ollama が返す。軽量モデルが役割どおりに答えるかは検証しない）。保存は API で確かめる。
 * 役割の保存の失敗だけ `page.route` で通信の境界に注入する。
 * 連結の順序・上限・表示名の分岐は UT（system-prompt.test.ts）、API の契約は IT が担う。
 */

const TITLE = '役割テスト';
const CUSTOM_ROLE = 'あなたは関西弁で話すアシスタントです。';
/** エージェントモードの保存先（page.tsx の localStorage キー） */
const AGENT_TOOLS_KEY = 'agent-tools-enabled';

/**
 * ヘッダーの役割ボタン。ボタン名に現在の役割の表示名が入る。
 *
 * @param page - 対象のページ
 * @param label - 期待する役割の表示名（省略時は表示名を問わない）
 * @returns 役割ボタンのロケーター
 */
function roleButton(page: Page, label?: string) {
  return page.getByRole('button', {
    name: label ? `会話の役割: ${label}` : /^会話の役割:/,
  });
}

/**
 * 役割の編集ダイアログ。
 *
 * @param page - 対象のページ
 * @returns ダイアログのロケーター
 */
function roleDialog(page: Page) {
  return page.getByRole('dialog', { name: '会話の役割' });
}

/**
 * 役割の編集ダイアログを開く。
 *
 * @param page - 対象のページ
 */
async function openRoleDialog(page: Page) {
  await roleButton(page).click();
  await expect(roleDialog(page)).toBeVisible();
}

/**
 * 次に送られる `/api/chat` のリクエストを待つ（観察するだけで、通信は変えない）。
 *
 * @param page - 対象のページ
 * @returns `/api/chat` への POST リクエスト
 */
function waitForChatRequest(page: Page): Promise<Request> {
  return page.waitForRequest(
    (req) => req.url().endsWith('/api/chat') && req.method() === 'POST'
  );
}

/**
 * 投入した会話をトップから開く。
 *
 * @param page - 対象のページ
 */
async function openSeededConversation(page: Page) {
  await page.goto('/');
  await page.getByText(TITLE).click();
}

test.describe('会話の役割（システムプロンプト）', () => {
  test.setTimeout(180000);

  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('新しい会話で選んだ役割は、最初の送信で会話と一緒に保存され、送信にも付く', async ({
      page,
      request,
    }) => {
      await page.goto('/');
      await expect(roleButton(page, '役割なし')).toBeVisible();

      await openRoleDialog(page);
      await roleDialog(page)
        .getByRole('button', { name: '翻訳者', exact: true })
        .click();
      const presetPrompt = await roleDialog(page)
        .getByLabel('役割（システムプロンプト）')
        .inputValue();
      await roleDialog(page).getByRole('button', { name: '保存' }).click();

      await expect(roleDialog(page)).toBeHidden();
      await expect(roleButton(page, '翻訳者')).toBeVisible();

      const chatRequest = waitForChatRequest(page);
      await sendMessage(page, 'Good morning');
      expect((await chatRequest).postDataJSON().systemPrompt).toBe(
        presetPrompt
      );
      await waitForResponseComplete(page);

      const [conv] = await fetchConversations(request);
      expect(conv.systemPrompt).toBe(presetPrompt);
      // 開き直しても、会話に保存した役割が表示される
      await page.reload();
      await page.getByText(conv.title).click();
      await expect(roleButton(page, '翻訳者')).toBeVisible();
    });

    test('既存の会話の役割を変えると保存され、次の送信から新しい役割が付く', async ({
      page,
      request,
    }) => {
      await createConversation(request, TITLE, 'あなたは日本語教師です。');
      await openSeededConversation(page);
      await expect(roleButton(page, 'カスタム')).toBeVisible();

      await openRoleDialog(page);
      await roleDialog(page)
        .getByLabel('役割（システムプロンプト）')
        .fill(CUSTOM_ROLE);
      await roleDialog(page).getByRole('button', { name: '保存' }).click();
      await expect(roleDialog(page)).toBeHidden();

      const [conv] = await fetchConversations(request);
      expect(conv.systemPrompt).toBe(CUSTOM_ROLE);

      const chatRequest = waitForChatRequest(page);
      await sendMessage(page, 'こんにちは');
      expect((await chatRequest).postDataJSON().systemPrompt).toBe(CUSTOM_ROLE);
      await waitForResponseComplete(page);
    });
  });

  test.describe('準正常系', () => {
    test('「役割なし」で保存すると役割が外れ、送信に役割が付かない', async ({
      page,
      request,
    }) => {
      await createConversation(request, TITLE, CUSTOM_ROLE);
      await openSeededConversation(page);

      await openRoleDialog(page);
      await roleDialog(page)
        .getByRole('button', { name: '役割なし', exact: true })
        .click();
      await expect(
        roleDialog(page).getByLabel('役割（システムプロンプト）')
      ).toHaveValue('');
      await roleDialog(page).getByRole('button', { name: '保存' }).click();

      await expect(roleButton(page, '役割なし')).toBeVisible();
      expect((await fetchConversations(request))[0].systemPrompt).toBeNull();

      const chatRequest = waitForChatRequest(page);
      await sendMessage(page, 'こんにちは');
      expect((await chatRequest).postDataJSON().systemPrompt).toBeUndefined();
      await waitForResponseComplete(page);
    });

    test('キャンセル・Escape では役割を変えない', async ({ page, request }) => {
      await createConversation(request, TITLE, CUSTOM_ROLE);
      await openSeededConversation(page);
      const textarea =
        roleDialog(page).getByLabel('役割（システムプロンプト）');

      await openRoleDialog(page);
      await textarea.fill('書きかけの役割');
      await roleDialog(page)
        .getByRole('button', { name: 'キャンセル' })
        .click();
      await expect(roleDialog(page)).toBeHidden();

      // 開き直すと保存済みの役割から始まる（書きかけは残らない）
      await openRoleDialog(page);
      await expect(textarea).toHaveValue(CUSTOM_ROLE);
      await textarea.fill('書きかけの役割');
      await page.keyboard.press('Escape');
      await expect(roleDialog(page)).toBeHidden();

      await expect(roleButton(page, 'カスタム')).toBeVisible();
      expect((await fetchConversations(request))[0].systemPrompt).toBe(
        CUSTOM_ROLE
      );
    });

    test('新しい会話を始め直すと、前に選んだ役割を持ち越さない', async ({
      page,
      request,
    }) => {
      // 新規会話のボタンは新規会話の画面では押せないため、一度既存の会話へ移ってから戻る
      await createConversation(request, TITLE);
      await page.goto('/');
      await openRoleDialog(page);
      await roleDialog(page)
        .getByRole('button', { name: 'コードレビュアー', exact: true })
        .click();
      await roleDialog(page).getByRole('button', { name: '保存' }).click();
      await expect(roleButton(page, 'コードレビュアー')).toBeVisible();

      // 既存の会話ではその会話の役割（役割なし）が表示される
      await page.getByText(TITLE).click();
      await expect(roleButton(page, '役割なし')).toBeVisible();

      await page.getByText('New Conversation').click();
      await expect(roleButton(page, '役割なし')).toBeVisible();
    });

    test('エージェントモードでは、会話の役割の後ろにエージェントのプリセットを連結して送る', async ({
      page,
      request,
    }) => {
      await createConversation(request, TITLE, CUSTOM_ROLE);
      await page.goto('/');
      await page.evaluate(
        (key) => localStorage.setItem(key, 'true'),
        AGENT_TOOLS_KEY
      );
      await openSeededConversation(page);

      const chatRequest = waitForChatRequest(page);
      await sendMessage(page, '今日は何曜日ですか');
      const body = (await chatRequest).postDataJSON();

      expect(body.enableTools).toBe(true);
      expect(body.systemPrompt.startsWith(`${CUSTOM_ROLE}\n\n`)).toBe(true);
      expect(body.systemPrompt.length).toBeGreaterThan(CUSTOM_ROLE.length + 2);

      // 応答の中身は見ないため、生成は止めて後続のテストを待たせない
      await stopButton(page)
        .click({ timeout: 5000 })
        .catch(() => {});
      await page.evaluate(
        (key) => localStorage.removeItem(key),
        AGENT_TOOLS_KEY
      );
    });
  });

  test.describe('異常系', () => {
    test('役割の保存に失敗したら、ダイアログにエラーを出して入力を残し、役割は変えない', async ({
      page,
      request,
    }) => {
      await createConversation(request, TITLE, CUSTOM_ROLE);
      await page.route('**/api/conversations/*', async (route) => {
        if (route.request().method() === 'PATCH') {
          await route.fulfill({
            status: 500,
            json: { error: '会話の更新に失敗しました' },
          });
          return;
        }
        await route.continue();
      });
      await openSeededConversation(page);

      await openRoleDialog(page);
      await roleDialog(page)
        .getByLabel('役割（システムプロンプト）')
        .fill('保存できない役割');
      await roleDialog(page).getByRole('button', { name: '保存' }).click();

      await expect(roleDialog(page).getByRole('alert')).toHaveText(
        '会話の更新に失敗しました'
      );
      await expect(roleDialog(page)).toBeVisible();
      await expect(
        roleDialog(page).getByLabel('役割（システムプロンプト）')
      ).toHaveValue('保存できない役割');
      expect((await fetchConversations(request))[0].systemPrompt).toBe(
        CUSTOM_ROLE
      );

      await roleDialog(page)
        .getByRole('button', { name: 'キャンセル' })
        .click();
      await expect(roleButton(page, 'カスタム')).toBeVisible();
    });

    test('上限を超える役割は入力できず、上限で止まる', async ({ page }) => {
      await page.goto('/');
      await openRoleDialog(page);
      const textarea =
        roleDialog(page).getByLabel('役割（システムプロンプト）');

      await textarea.fill('あ'.repeat(5001));

      // 保存 API の上限（IT で 400 を確認）を超える値は、入力の時点で切り詰められる
      expect((await textarea.inputValue()).length).toBe(5000);
      await expect(roleDialog(page).getByText('5,000 / 5,000')).toBeVisible();
    });
  });
});
