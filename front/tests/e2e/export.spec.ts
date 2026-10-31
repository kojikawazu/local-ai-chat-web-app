import { readFile } from 'node:fs/promises';
import type { Download, Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import {
  cleanupAllConversations,
  createConversation,
  createMessage,
} from './helpers/test-data';
import { startLongAnswer, stopButton } from './helpers/long-answer';

/**
 * 応答・会話の書き出し（ダウンロード）の E2E（#12）。
 *
 * 書き出す会話は API で用意する（中身の検証はモデルの出力に依存しないため。軽量モデル・CI でも動く）。
 * 生成中に押せないことだけは、実際の Ollama に長い応答を生成させて確かめる。
 * 形式の細かい決まり（見出し・日時・ファイル名の置き換え）は UT（`tests/unit/export.test.ts`）で見る。
 * ここではブラウザから実際にファイルが保存されること・ボタンの出し方を見る。
 */

const TITLE = '書き出しの検証';
const QUESTION = '京都の見どころは？';
/** 応答の Markdown の原文 */
const ANSWER = ['## 見どころ', '', '- 清水寺', '- 伏見稲荷'].join('\n');
/** 応答に付けるツールの結果（JSON だけに入ることを確かめる） */
const TOOL_CALL = {
  name: 'calculate',
  arguments: { expression: '1+1' },
  result: '2',
  isError: false,
  durationMs: 3,
};

/** ファイル名の日時の部分（`_YYYY-MM-DD_HHmm`） */
const DATE_PART = String.raw`_\d{4}-\d{2}-\d{2}_\d{4}`;

/**
 * 会話全体を書き出すボタンのロケーター。
 *
 * @param page - 対象のページ
 * @returns 「会話を書き出す」ボタン
 */
const exportButton = (page: Page) =>
  page.getByRole('button', { name: '会話を書き出す' });

/**
 * 応答を 1 件持つ会話を用意して開く。
 *
 * @param page - 対象のページ
 * @param request - API 呼び出しに使うリクエストコンテキスト
 * @param title - 会話のタイトル
 */
async function openSeededConversation(
  page: Page,
  request: Parameters<typeof createConversation>[0],
  title = TITLE
) {
  const conv = await createConversation(request, title);
  await createMessage(request, conv.id, 'user', QUESTION);
  await createMessage(request, conv.id, 'assistant', ANSWER, {
    toolCalls: [TOOL_CALL],
  });

  await page.goto('/');
  await page.locator('aside').getByText(title).click();
  await expect(page.getByRole('heading', { name: '見どころ' })).toBeVisible();
}

/**
 * 保存されたファイルの中身を読む。
 *
 * @param download - Playwright のダウンロード
 * @returns ファイルの中身（UTF-8）
 */
async function readDownload(download: Download): Promise<string> {
  const path = await download.path();
  return readFile(path, 'utf-8');
}

/**
 * 書き出しのダイアログで形式を選び、保存されたファイルを受け取る。
 *
 * @param page - 対象のページ
 * @param format - 選ぶ形式のボタン名
 * @returns ダウンロード
 */
async function exportConversation(page: Page, format: 'Markdown' | 'JSON') {
  await exportButton(page).click();
  const dialog = page.getByRole('dialog', { name: '会話を書き出す' });
  await expect(dialog).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: new RegExp(`^${format}`) }).click(),
  ]);
  return download;
}

/**
 * 応答の下の「保存」から、応答を Markdown で保存する（#36 で形式を選ぶダイアログを挟むようになった）。
 *
 * @param page - 対象のページ
 * @returns ダウンロード
 */
async function saveAnswerAsMarkdown(page: Page) {
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '応答を保存' });
  await expect(dialog).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: /^Markdown/ }).click(),
  ]);
  await expect(dialog).toBeHidden();
  return download;
}

test.describe('書き出し', () => {
  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('応答の「保存」で Markdown を選ぶと、応答の原文が .md で保存される', async ({
      page,
      request,
    }) => {
      await openSeededConversation(page, request);

      const download = await saveAnswerAsMarkdown(page);

      expect(download.suggestedFilename()).toMatch(
        new RegExp(`^${TITLE}${DATE_PART}\\.md$`)
      );
      expect(await readDownload(download)).toBe(ANSWER);
    });

    test('会話全体を Markdown で書き出すと、質問と応答が見出し付きで並び、ダイアログが閉じる', async ({
      page,
      request,
    }) => {
      await openSeededConversation(page, request);

      const download = await exportConversation(page, 'Markdown');

      expect(download.suggestedFilename()).toMatch(
        new RegExp(`^${TITLE}${DATE_PART}\\.md$`)
      );
      const content = await readDownload(download);
      expect(content.startsWith(`# ${TITLE}\n`)).toBe(true);
      expect(content).toMatch(/## ユーザー（.+）\n\n京都の見どころは？/);
      expect(content).toContain(`## アシスタント（`);
      expect(content).toContain(ANSWER);
      // ツールの結果は読み物の Markdown には入れない
      expect(content).not.toContain('calculate');

      await expect(page.getByRole('dialog')).toBeHidden();
      await expect(exportButton(page)).toBeFocused();
    });

    test('会話全体を JSON で書き出すと、ツールの結果を含めてすべて残る', async ({
      page,
      request,
    }) => {
      await openSeededConversation(page, request);

      const download = await exportConversation(page, 'JSON');

      expect(download.suggestedFilename()).toMatch(
        new RegExp(`^${TITLE}${DATE_PART}\\.json$`)
      );
      const data = JSON.parse(await readDownload(download));
      expect(data.version).toBe(2);
      expect(data.conversation.title).toBe(TITLE);
      expect(
        data.messages.map((m: { role: string; content: string }) => [
          m.role,
          m.content,
        ])
      ).toEqual([
        ['user', QUESTION],
        ['assistant', ANSWER],
      ]);
      expect(data.messages[1].metadata.toolCalls).toEqual([TOOL_CALL]);
    });
  });

  test.describe('準正常系', () => {
    test('会話を開く前（新しい会話）は「会話を書き出す」を押せない', async ({
      page,
    }) => {
      await page.goto('/');
      await expect(exportButton(page)).toBeDisabled();
    });

    test('キャンセルではファイルを保存せずに閉じ、ボタンへフォーカスが戻る', async ({
      page,
      request,
    }) => {
      await openSeededConversation(page, request);
      let downloaded = false;
      page.on('download', () => {
        downloaded = true;
      });

      await exportButton(page).click();
      await page
        .getByRole('dialog', { name: '会話を書き出す' })
        .getByRole('button', { name: 'キャンセル' })
        .click();

      await expect(page.getByRole('dialog')).toBeHidden();
      await expect(exportButton(page)).toBeFocused();
      expect(downloaded).toBe(false);
    });

    test('応答の生成中は「会話を書き出す」を押せず、生成が終わると押せる', async ({
      page,
      request,
    }) => {
      test.setTimeout(240000);
      await openSeededConversation(page, request);

      await startLongAnswer(page);
      await expect(exportButton(page)).toBeDisabled();

      await stopButton(page).click();
      await expect(exportButton(page)).toBeEnabled();
    });
  });

  test.describe('異常系', () => {
    test('ファイル名に使えない文字を含むタイトルでも、保存するファイル名に残らない', async ({
      page,
      request,
    }) => {
      const title = '設計/レビュー: 案*1?';
      await openSeededConversation(page, request, title);

      const download = await saveAnswerAsMarkdown(page);

      const name = download.suggestedFilename();
      expect(name).toMatch(
        new RegExp(`^設計_レビュー_ 案_1_${DATE_PART}\\.md$`)
      );
      expect(name).not.toMatch(/[\\/:*?"<>|]/);
    });
  });
});
