import { readFile } from 'node:fs/promises';
import type { APIRequestContext, Download, Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import {
  cleanupAllConversations,
  createConversation,
  createMessage,
} from './helpers/test-data';

/** zip の中の、埋め込んだ画像のファイル（フォルダの項目 `word/media/` だけでは数えない） */
const MEDIA_FILE = /^word\/media\/[^/]+\.(?:png|jpe?g)$/;

/**
 * HTML レポート・PDF・DOCX の書き出しの E2E（#36。`docs/24-html-report-export.md`・`docs/25-docx-export.md`）。
 *
 * 会話は API で作る（Ollama を使わず、軽量モデル・CI でも動く）。Markdown の変換・安全策（生の HTML・危ない URL・
 * 外部の画像）・図と画像の埋め込みの組み立ては UT（report-html.test.ts）が担い、ここでは実際のブラウザで、
 * 書き出しのダイアログから保存したファイルの中身・Mermaid の図を描いて入れること・PDF の印刷が開くことを見る。
 * PDF はブラウザの印刷のダイアログを自動で操作できないため、`print` をブラウザの API の境界で差し替え、
 * 呼ばれたことと、印刷する文書（iframe の中）がレポートであることを確かめる。
 */

const BASE_URL = 'http://localhost:3000';
const TITLE = 'レポートの会話';

/** 1×1 の PNG（添付画像の保存 API は中身の先頭で形式を判定するため、本物の PNG にする） */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** 応答の Markdown（見出し・表・コード） */
const ANSWER = [
  '## 手順',
  '',
  '| 列 | 値 |',
  '|---|---|',
  '| a | 1 |',
  '',
  '```ts',
  'const answer = 42;',
  '```',
].join('\n');

/**
 * 画像を添付した質問と応答の会話を API で作る。
 *
 * @param request - API のリクエストのコンテキスト
 * @param answer - 応答の Markdown
 * @returns 会話の ID
 */
async function createReportConversation(
  request: APIRequestContext,
  answer = ANSWER
) {
  const conversation = await createConversation(request, TITLE);
  const res = await request.post(
    `${BASE_URL}/api/conversations/${conversation.id}/messages`,
    {
      data: {
        role: 'user',
        content: 'この画像について教えて',
        attachments: [
          { id: crypto.randomUUID(), data: PNG_BASE64, width: 1, height: 1 },
        ],
      },
    }
  );
  expect(res.status()).toBe(201);
  await createMessage(request, conversation.id, 'assistant', answer);
  return conversation.id;
}

/**
 * 会話を開く。
 *
 * @param page - 対象のページ
 */
async function openConversation(page: Page) {
  await page.goto('/');
  await page
    .locator('aside')
    .getByRole('button', { name: TITLE, exact: true })
    .click();
  await expect(
    page.locator('main').getByText('この画像について教えて')
  ).toBeVisible();
}

/**
 * ダウンロードしたファイルを文字列で読む。
 *
 * @param download - ダウンロード
 * @returns ファイルの中身
 */
async function readDownload(download: Download): Promise<string> {
  return readFile(await download.path(), 'utf-8');
}

/**
 * 会話の書き出しのダイアログで形式を選ぶ。
 *
 * @param page - 対象のページ
 * @param format - 押す形式のボタン（名前の先頭）
 * @returns ダイアログのロケーター
 */
async function chooseConversationFormat(
  page: Page,
  format: 'HTML' | 'PDF' | 'DOCX'
) {
  await page.getByRole('button', { name: '会話を書き出す' }).click();
  const dialog = page.getByRole('dialog', { name: '会話を書き出す' });
  await dialog.getByRole('button', { name: new RegExp(`^${format}`) }).click();
  return dialog;
}

/**
 * 会話全体を HTML で書き出し、保存されたファイルを受け取る。
 *
 * @param page - 対象のページ
 * @returns ダウンロード
 */
async function exportConversationHtml(page: Page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    chooseConversationFormat(page, 'HTML'),
  ]);
  return download;
}

/**
 * `print` を差し替え、呼ばれた回数と印刷した文書の見出しを親のページに残す（ブラウザの API の境界への注入）。
 * 初期化のスクリプトは iframe（`srcdoc`）の中でも動くため、iframe の `print` も差し替わる。
 *
 * @param page - 対象のページ
 * @param fail - true なら `print` を失敗させる
 */
async function stubPrint(page: Page, fail = false) {
  await page.addInitScript((shouldFail: boolean) => {
    window.print = () => {
      if (shouldFail) throw new Error('印刷の失敗');
      // 印刷の結果を、テストが読める親のページ（top）に残す
      const top = window.top as Window & {
        __printed?: {
          count: number;
          heading: string | null;
          hasStyle: boolean;
        };
      };
      top.__printed = {
        count: (top.__printed?.count ?? 0) + 1,
        heading: document.querySelector('h1')?.textContent ?? null,
        hasStyle: document.querySelector('style') !== null,
      };
    };
  }, fail);
}

/**
 * 保存された DOCX を開き、本文の XML とファイル名の一覧を読む。
 *
 * @param download - ダウンロード
 * @returns `word/document.xml` の中身と、zip の中のファイル名の一覧
 */
async function readDocx(download: Download) {
  const zip = await JSZip.loadAsync(await readFile(await download.path()));
  return {
    documentXml: (await zip.file('word/document.xml')?.async('string')) ?? '',
    files: Object.keys(zip.files),
  };
}

/**
 * 会話全体を DOCX で書き出し、保存されたファイルを受け取る。
 *
 * @param page - 対象のページ
 * @returns ダウンロード
 */
async function exportConversationDocx(page: Page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    chooseConversationFormat(page, 'DOCX'),
  ]);
  return download;
}

test.describe('HTML レポート・PDF・DOCX の書き出し', () => {
  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('会話を HTML で書き出すと、整形したレポートが 1 ファイルで保存される', async ({
      page,
      request,
    }) => {
      await createReportConversation(request);
      await openConversation(page);

      const download = await exportConversationHtml(page);

      expect(download.suggestedFilename()).toMatch(
        /^レポートの会話_\d{4}-\d{2}-\d{2}_\d{4}\.html$/
      );
      const html = await readDownload(download);
      expect(html.startsWith('<!doctype html>')).toBe(true);
      expect(html).toContain('<h1>レポートの会話</h1>');
      expect(html).toMatch(/<h2>ユーザー（/);
      expect(html).toMatch(/<h2>アシスタント（/);
      expect(html).toContain('<td>a</td>');
      expect(html).toContain('<span class="hljs-keyword">const</span>');
      // 添付画像は DB から読んで data: URI で埋め込む
      expect(html).toContain('src="data:image/png;base64,');
      expect(html).not.toMatch(/<script/i);
      await expect(
        page.getByRole('dialog', { name: '会話を書き出す' })
      ).toBeHidden();
    });

    test('応答の「保存」で HTML を選ぶと、その応答だけのレポートが保存される', async ({
      page,
      request,
    }) => {
      await createReportConversation(request);
      await openConversation(page);

      await page.getByRole('button', { name: '保存', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '応答を保存' });
      // 応答 1 件には JSON を出さない
      await expect(dialog.getByRole('button', { name: /^JSON/ })).toHaveCount(
        0
      );
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        dialog.getByRole('button', { name: /^HTML/ }).click(),
      ]);

      const html = await readDownload(download);
      expect(html).toContain('<h2>手順</h2>');
      expect(html).not.toContain('この画像について教えて');
      expect(html.match(/<section/g)).toHaveLength(1);
    });

    test('PDF を選ぶと、レポートを読み込んだ印刷の画面が開く', async ({
      page,
      request,
    }) => {
      await stubPrint(page);
      await createReportConversation(request);
      await openConversation(page);

      const dialog = await chooseConversationFormat(page, 'PDF');

      await expect(dialog).toBeHidden();
      const printed = await page.evaluate(
        () => (window as Window & { __printed?: unknown }).__printed ?? null
      );
      expect(printed).toEqual({
        count: 1,
        heading: 'レポートの会話',
        hasStyle: true,
      });
    });

    test('Mermaid の図は描いた SVG を <img> で入れる', async ({
      page,
      request,
    }) => {
      await createReportConversation(
        request,
        '図です。\n\n```mermaid\ngraph TD; A-->B\n```'
      );
      await openConversation(page);

      const html = await readDownload(await exportConversationHtml(page));

      expect(html).toContain('<img src="data:image/svg+xml');
      expect(html).toContain('alt="mermaid の図"');
      expect(html).not.toContain('language-mermaid');
    });

    test('会話を DOCX で書き出すと、見出し・表・コード・添付画像の入った Word のファイルが保存される', async ({
      page,
      request,
    }) => {
      await createReportConversation(request);
      await openConversation(page);

      const download = await exportConversationDocx(page);

      expect(download.suggestedFilename()).toMatch(
        /^レポートの会話_\d{4}-\d{2}-\d{2}_\d{4}\.docx$/
      );
      const { documentXml, files } = await readDocx(download);
      expect(documentXml).toContain('レポートの会話');
      expect(documentXml).toContain('<w:pStyle w:val="Heading1"/>');
      expect(documentXml).toContain('<w:pStyle w:val="Heading3"/>');
      expect(documentXml).toContain('手順');
      expect(documentXml).toContain('<w:tbl>');
      expect(documentXml).toContain('const answer = 42;');
      // 添付画像を埋め込む
      expect(files.some((name) => MEDIA_FILE.test(name))).toBe(true);
      await expect(
        page.getByRole('dialog', { name: '会話を書き出す' })
      ).toBeHidden();
    });

    test('Mermaid の図は PNG で埋め込み、応答の「保存」からも DOCX にできる', async ({
      page,
      request,
    }) => {
      await createReportConversation(
        request,
        '図です。\n\n```mermaid\ngraph TD; A-->B\n```'
      );
      await openConversation(page);

      await page.getByRole('button', { name: '保存', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '応答を保存' });
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        dialog.getByRole('button', { name: /^DOCX/ }).click(),
      ]);

      const { documentXml, files } = await readDocx(download);
      expect(documentXml).toContain('図です。');
      // 応答 1 件なので、質問は入らない
      expect(documentXml).not.toContain('この画像について教えて');
      expect(documentXml).not.toContain('graph TD');
      expect(files.filter((name) => MEDIA_FILE.test(name))).toHaveLength(1);
    });
  });

  test.describe('準正常系', () => {
    test('PlantUML の図を描けなければ、ソースの文字のまま DOCX に入れる', async ({
      page,
      request,
    }) => {
      await page.route('**/api/diagrams/plantuml', (route) =>
        route.fulfill({ status: 502, json: { error: 'PlantUML の失敗' } })
      );
      await createReportConversation(
        request,
        '```plantuml\n@startuml\nA -> B\n@enduml\n```'
      );
      await openConversation(page);

      const { documentXml } = await readDocx(
        await exportConversationDocx(page)
      );

      expect(documentXml).toContain('@startuml');
      expect(documentXml).toContain('Consolas');
    });

    test('PlantUML の図を描けなければ、ソースのコードブロックのまま書き出す', async ({
      page,
      request,
    }) => {
      await page.route('**/api/diagrams/plantuml', (route) =>
        route.fulfill({ status: 502, json: { error: 'PlantUML の失敗' } })
      );
      await createReportConversation(
        request,
        '```plantuml\n@startuml\nA -> B\n@enduml\n```'
      );
      await openConversation(page);

      const html = await readDownload(await exportConversationHtml(page));

      expect(html).toContain('language-plantuml');
      expect(html).toContain('@startuml');
    });

    test('添付画像を読めなければ、注記にして書き出す', async ({
      page,
      request,
    }) => {
      await createReportConversation(request);
      await openConversation(page);
      // 画面に出た後で、書き出しのときの画像の取得だけを失敗させる
      await page.route('**/api/attachments/*', (route) =>
        route.fulfill({ status: 500, json: { error: '画像の失敗' } })
      );

      const html = await readDownload(await exportConversationHtml(page));

      expect(html).toContain('（画像を読み込めませんでした）');
      expect(html).not.toContain('data:image/png');
    });
  });

  test.describe('異常系', () => {
    test('応答の中の生の HTML・危ない URL は、レポートでも動かない', async ({
      page,
      request,
    }) => {
      await createReportConversation(
        request,
        '<script>alert(1)</script>\n\n[押す](javascript:alert(1))'
      );
      await openConversation(page);

      const html = await readDownload(await exportConversationHtml(page));

      expect(html).not.toMatch(/<script/i);
      expect(html).not.toContain('javascript:');
      expect(html).toContain('<a>押す</a>');
    });

    test('印刷を開けなければ、ダイアログにエラーを出して閉じない', async ({
      page,
      request,
    }) => {
      await stubPrint(page, true);
      await createReportConversation(request);
      await openConversation(page);

      const dialog = await chooseConversationFormat(page, 'PDF');

      await expect(
        dialog.getByRole('alert').getByText('レポートを書き出せませんでした')
      ).toBeVisible();
      await expect(dialog).toBeVisible();
      // 失敗の後も選び直せる
      await expect(dialog.getByRole('button', { name: /^HTML/ })).toBeEnabled();
    });
  });
});
