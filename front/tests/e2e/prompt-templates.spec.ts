import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { startLongAnswer, stopButton } from './helpers/long-answer';
import {
  cleanupAllConversations,
  fillTextarea,
  waitForResponseComplete,
} from './helpers/test-data';

/**
 * プロンプトテンプレート（#28）の E2E。
 *
 * 入力欄の先頭の `/` で候補が出て、キー・クリックで本文が入ること、管理画面での作成・編集・削除、
 * 一覧が空のときの「例を追加」を、実際の API と DB で確かめる。テンプレートを入れるところまでは Ollama を使わない。
 * 失敗の表示だけ `page.route` で通信の境界に注入する。候補の条件・絞り込みは UT、API の契約は IT が担う。
 *
 * 開発の DB を使うため、利用者が作ったテンプレートを最初に控えて全件消し、最後に控えたものを作り直す。
 */

const TEMPLATES_API = '/api/prompt-templates';

/** テストで作るテンプレート（API の応答の形のうち、作成に送る項目だけ） */
type TemplateInput = { name: string; shortcut: string; content: string };

const TRANSLATE: TemplateInput = {
  name: '英語に翻訳',
  shortcut: 'translate',
  content: '以下を英語に翻訳してください。\n\n',
};
const SUMMARIZE: TemplateInput = {
  name: '要約',
  shortcut: 'summarize',
  content: '以下を要約してください。\n\n',
};
const REVIEW: TemplateInput = {
  name: 'コードレビュー',
  shortcut: 'review',
  content: '以下のコードをレビューしてください。\n\n',
};

/**
 * テンプレートの一覧を API から読む。
 *
 * @param request - Playwright の API クライアント
 * @returns 一覧（作成日時・ID を含む API の応答のまま）
 */
async function fetchTemplates(
  request: APIRequestContext
): Promise<(TemplateInput & { id: string })[]> {
  const res = await request.get(TEMPLATES_API);
  expect(res.ok()).toBe(true);
  return (await res.json()).templates;
}

/**
 * テンプレートを全件消す。
 *
 * @param request - Playwright の API クライアント
 */
async function deleteAllTemplates(request: APIRequestContext) {
  for (const template of await fetchTemplates(request)) {
    await request.delete(`${TEMPLATES_API}/${template.id}`);
  }
}

/**
 * テンプレートを API で作る。
 *
 * @param request - Playwright の API クライアント
 * @param inputs - 作るテンプレート
 */
async function seedTemplates(
  request: APIRequestContext,
  inputs: TemplateInput[]
) {
  for (const input of inputs) {
    const res = await request.post(TEMPLATES_API, { data: input });
    expect(res.status()).toBe(201);
  }
}

/**
 * 入力欄の上の候補の一覧。
 *
 * @param page - 対象のページ
 * @returns 候補の `listbox` のロケーター
 */
function suggestions(page: Page) {
  return page.getByRole('listbox', { name: 'プロンプトテンプレート' });
}

/**
 * 管理画面のダイアログ。
 *
 * @param page - 対象のページ
 * @returns ダイアログのロケーター
 */
function templateDialog(page: Page) {
  return page.getByRole('dialog', { name: 'プロンプトテンプレート' });
}

/**
 * 管理画面を設定モーダルから開く。
 *
 * @param page - 対象のページ
 */
async function openTemplateDialogFromSettings(page: Page) {
  await page
    .locator('aside')
    .getByRole('button', { name: '設定を開く' })
    .click();
  await page
    .getByRole('dialog', { name: '設定' })
    .getByRole('button', { name: '管理', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: '設定' })).toBeHidden();
  await expect(templateDialog(page)).toBeVisible();
}

/**
 * 管理画面のフォームに入力する（React の controlled input に届くよう 1 文字ずつ打つ）。
 *
 * @param page - 対象のページ
 * @param input - 入れる値。省略した項目は触らない
 */
async function fillTemplateForm(page: Page, input: Partial<TemplateInput>) {
  const dialog = templateDialog(page);
  const fields: [string, string | undefined][] = [
    ['名前', input.name],
    ['ショートカット', input.shortcut],
    ['本文', input.content],
  ];
  for (const [label, value] of fields) {
    if (value === undefined) continue;
    const field = dialog.getByLabel(label, { exact: true });
    await field.clear();
    await field.pressSequentially(value, { delay: 10 });
  }
}

/**
 * トップを開き、テンプレートの一覧を読み終えるまで待つ（読む前に `/` を打つと候補が出ないため）。
 *
 * @param page - 対象のページ
 */
async function openTop(page: Page) {
  const loaded = page.waitForResponse(
    (res) =>
      res.url().endsWith(TEMPLATES_API) && res.request().method() === 'GET'
  );
  await page.goto('/');
  await loaded;
}

test.describe('プロンプトテンプレート', () => {
  test.setTimeout(180000);

  /** 開始時にあった利用者のテンプレート。最後に作り直す */
  let saved: TemplateInput[] = [];

  test.beforeAll(async ({ request }) => {
    saved = (await fetchTemplates(request)).map(
      ({ name, shortcut, content }) => ({ name, shortcut, content })
    );
  });

  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
    await deleteAllTemplates(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
    await deleteAllTemplates(request);
    await seedTemplates(request, saved);
  });

  test.describe('正常系', () => {
    test('/ で候補が出て、Enter で本文が入る（送信はしない）', async ({
      page,
      request,
    }) => {
      await seedTemplates(request, [TRANSLATE, SUMMARIZE]);
      await openTop(page);
      const chatRequests: string[] = [];
      page.on('request', (req) => {
        if (req.url().endsWith('/api/chat')) chatRequests.push(req.url());
      });

      await fillTextarea(page, '/');
      const textarea = page.locator('textarea');
      await expect(suggestions(page)).toBeVisible();
      await expect(textarea).toHaveAttribute('aria-expanded', 'true');
      // ショートカットの昇順。先頭が選択中
      await expect(suggestions(page).getByRole('option')).toHaveText([
        /\/summarize\s*要約/,
        /\/translate\s*英語に翻訳/,
      ]);
      await expect(
        suggestions(page).getByRole('option', { selected: true })
      ).toContainText('/summarize');

      await textarea.press('Enter');
      await expect(textarea).toHaveValue(SUMMARIZE.content);
      await expect(suggestions(page)).toBeHidden();
      // カーソルは本文の末尾。続けて打つと末尾に入る
      await textarea.pressSequentially('テスト');
      await expect(textarea).toHaveValue(`${SUMMARIZE.content}テスト`);
      expect(chatRequests).toEqual([]);
    });

    test('打った文字で絞り込み、↑↓ で選んで Tab で入れる', async ({
      page,
      request,
    }) => {
      await seedTemplates(request, [TRANSLATE, SUMMARIZE, REVIEW]);
      await openTop(page);

      await fillTextarea(page, '/r');
      // ショートカットの前方一致は review だけ。名前はどれも日本語のため、名前の部分一致は無い
      await expect(suggestions(page).getByRole('option')).toHaveCount(1);

      const textarea = page.locator('textarea');
      await textarea.press('Backspace');
      await expect(suggestions(page).getByRole('option')).toHaveCount(3);
      // 先頭（review）から ↓ 2 回で translate、↑ 1 回で summarize
      await textarea.press('ArrowDown');
      await textarea.press('ArrowDown');
      await textarea.press('ArrowUp');
      await expect(
        suggestions(page).getByRole('option', { selected: true })
      ).toContainText('/summarize');
      await textarea.press('Tab');
      await expect(textarea).toHaveValue(SUMMARIZE.content);
      await expect(textarea).toBeFocused();
    });

    test('名前で探して、クリックで入れる', async ({ page, request }) => {
      await seedTemplates(request, [TRANSLATE, SUMMARIZE]);
      await openTop(page);

      await fillTextarea(page, '/翻訳');
      await suggestions(page)
        .getByRole('option', { name: /英語に翻訳/ })
        .click();
      const textarea = page.locator('textarea');
      await expect(textarea).toHaveValue(TRANSLATE.content);
      await expect(textarea).toBeFocused();
    });

    test('管理画面で作成・編集・削除し、候補に反映される', async ({
      page,
      request,
    }) => {
      await openTop(page);
      await openTemplateDialogFromSettings(page);
      const dialog = templateDialog(page);

      // 作成
      await dialog.getByRole('button', { name: '新しいテンプレート' }).click();
      await fillTemplateForm(page, {
        name: '丁寧に',
        shortcut: 'Polite',
        content: '以下を丁寧な文に直してください。',
      });
      await dialog.getByRole('button', { name: '保存' }).click();
      const row = dialog.getByRole('listitem', { name: '/polite' });
      await expect(row).toContainText('丁寧に');

      // 編集
      await row.getByRole('button', { name: '編集' }).click();
      await fillTemplateForm(page, { name: 'ていねいに' });
      await dialog.getByRole('button', { name: '保存' }).click();
      await expect(
        dialog.getByRole('listitem', { name: '/polite' })
      ).toContainText('ていねいに');
      expect((await fetchTemplates(request)).map((t) => t.name)).toEqual([
        'ていねいに',
      ]);

      // 閉じると入力欄にフォーカスが戻り、候補に出る
      // 右上の × も「閉じる」のため、下のボタンを押す
      await dialog.getByRole('button', { name: '閉じる' }).last().click();
      await expect(dialog).toBeHidden();
      await expect(page.locator('textarea')).toBeFocused();
      await fillTextarea(page, '/po');
      await expect(suggestions(page).getByRole('option')).toHaveText([
        /\/polite\s*ていねいに/,
      ]);

      // 候補の「テンプレートを管理」から開き、2 段階で削除する
      await page.getByRole('button', { name: 'テンプレートを管理' }).click();
      await expect(dialog).toBeVisible();
      const polite = dialog.getByRole('listitem', { name: '/polite' });
      await polite.getByRole('button', { name: '削除', exact: true }).click();
      // 1 段階目では消えない。やめると元に戻る
      await polite.getByRole('button', { name: 'やめる' }).click();
      expect(await fetchTemplates(request)).toHaveLength(1);
      await polite.getByRole('button', { name: '削除', exact: true }).click();
      await polite.getByRole('button', { name: '削除する' }).click();
      await expect(polite).toBeHidden();
      await expect(dialog.getByText('テンプレートがありません')).toBeVisible();
      expect(await fetchTemplates(request)).toEqual([]);
    });

    test('一覧が空なら、候補の「例を追加」で 4 件を作り、そのまま候補に出る', async ({
      page,
      request,
    }) => {
      await openTop(page);
      await fillTextarea(page, '/');
      await expect(suggestions(page)).toBeVisible();
      await expect(page.getByText('テンプレートがありません')).toBeVisible();

      await page.getByRole('button', { name: '例を追加' }).click();
      await expect(suggestions(page).getByRole('option')).toHaveText([
        /\/review/,
        /\/slides/,
        /\/summarize/,
        /\/translate/,
      ]);
      expect(await fetchTemplates(request)).toHaveLength(4);
      await expect(page.locator('textarea')).toHaveValue('/');
    });
  });

  test.describe('準正常系', () => {
    test('一致するものが無ければその旨を出し、Enter はいつもどおり送信する', async ({
      page,
      request,
    }) => {
      await seedTemplates(request, [TRANSLATE]);
      await openTop(page);

      await fillTextarea(page, '/zzz');
      await expect(
        page.getByText('一致するテンプレートはありません')
      ).toBeVisible();
      const chatRequest = page.waitForRequest(
        (req) => req.url().endsWith('/api/chat') && req.method() === 'POST'
      );
      await page.locator('textarea').press('Enter');
      expect((await chatRequest).postDataJSON().message).toBe('/zzz');
      await waitForResponseComplete(page);
    });

    test('文の途中の / や、空白を打った後は候補を出さない', async ({
      page,
      request,
    }) => {
      await seedTemplates(request, [TRANSLATE]);
      await openTop(page);

      await fillTextarea(page, 'see a/b');
      await expect(suggestions(page)).toBeHidden();
      await page.locator('textarea').clear();
      await fillTextarea(page, '/translate ');
      await expect(suggestions(page)).toBeHidden();
      await expect(page.locator('textarea')).toHaveAttribute(
        'aria-expanded',
        'false'
      );
    });

    test('Escape は候補を閉じるだけで生成を止めず、打ち直すと開き直す', async ({
      page,
      request,
    }) => {
      await seedTemplates(request, [TRANSLATE]);
      await openTop(page);
      await startLongAnswer(page);

      await fillTextarea(page, '/tr');
      await expect(suggestions(page)).toBeVisible();
      const textarea = page.locator('textarea');
      await textarea.press('Escape');
      await expect(suggestions(page)).toBeHidden();
      await expect(stopButton(page)).toBeVisible();
      await expect(textarea).toHaveValue('/tr');

      await textarea.press('Backspace');
      await expect(suggestions(page)).toBeVisible();

      // 候補を閉じた後の 2 回目の Escape は、いつもどおり生成を止める
      await textarea.press('Escape');
      await textarea.press('Escape');
      await expect(stopButton(page)).toBeHidden({ timeout: 30000 });
    });

    test('使われているショートカットで保存すると、エラーを出して入力を残す', async ({
      page,
      request,
    }) => {
      await seedTemplates(request, [TRANSLATE]);
      await openTop(page);
      await openTemplateDialogFromSettings(page);
      const dialog = templateDialog(page);

      await dialog.getByRole('button', { name: '新しいテンプレート' }).click();
      await fillTemplateForm(page, {
        name: '別の翻訳',
        shortcut: 'translate',
        content: '本文',
      });
      await dialog.getByRole('button', { name: '保存' }).click();
      await expect(dialog.getByRole('alert')).toHaveText(
        'そのショートカットは既に使われています'
      );
      await expect(dialog.getByLabel('名前', { exact: true })).toHaveValue(
        '別の翻訳'
      );
      expect(await fetchTemplates(request)).toHaveLength(1);
    });

    test('形の合わないショートカットでは保存できない', async ({ page }) => {
      await openTop(page);
      await openTemplateDialogFromSettings(page);
      const dialog = templateDialog(page);

      await dialog.getByRole('button', { name: '新しいテンプレート' }).click();
      await fillTemplateForm(page, {
        name: '翻訳',
        shortcut: '-tr',
        content: '本文',
      });
      await expect(
        dialog.getByLabel('ショートカット', { exact: true })
      ).toHaveAttribute('aria-invalid', 'true');
      await expect(dialog.getByRole('button', { name: '保存' })).toBeDisabled();
    });
  });

  test.describe('異常系', () => {
    test('一覧を読めなければ候補を出さず、入力欄はいつもどおり使える', async ({
      page,
      request,
    }) => {
      await seedTemplates(request, [TRANSLATE]);
      await page.route(`**${TEMPLATES_API}`, (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 500,
              contentType: 'application/json',
              body: JSON.stringify({
                error: 'テンプレートの一覧の取得に失敗しました',
              }),
            })
          : route.continue()
      );
      await openTop(page);

      await fillTextarea(page, '/tr');
      await expect(suggestions(page)).toBeHidden();
      await expect(page.locator('textarea')).toHaveValue('/tr');
      await expect(page.getByRole('button', { name: '送信' })).toBeEnabled();
    });

    test('保存に失敗すると、エラーを出して入力を残す', async ({ page }) => {
      await page.route(`**${TEMPLATES_API}`, (route) =>
        route.request().method() === 'POST'
          ? route.fulfill({
              status: 500,
              contentType: 'application/json',
              body: JSON.stringify({
                error: 'テンプレートの作成に失敗しました',
              }),
            })
          : route.continue()
      );
      await openTop(page);
      await openTemplateDialogFromSettings(page);
      const dialog = templateDialog(page);

      await dialog.getByRole('button', { name: '新しいテンプレート' }).click();
      await fillTemplateForm(page, TRANSLATE);
      await dialog.getByRole('button', { name: '保存' }).click();
      await expect(dialog.getByRole('alert')).toHaveText(
        'テンプレートの作成に失敗しました'
      );
      await expect(dialog.getByLabel('本文', { exact: true })).toHaveValue(
        TRANSLATE.content
      );
    });
  });
});
