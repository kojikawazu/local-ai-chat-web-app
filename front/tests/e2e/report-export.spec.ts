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
 * HTML レポート・PDF・DOCX・HTML スライド・PPTX の書き出しの E2E（#36。`docs/24-html-report-export.md`・
 * `docs/25-docx-export.md`・`docs/26-html-slides-export.md`・`docs/27-pptx-export.md`）。
 *
 * 会話は API で作る（Ollama を使わず、軽量モデル・CI でも動く）。Markdown の変換・安全策（生の HTML・危ない URL・
 * 外部の画像）・図と画像の埋め込みの組み立ては UT（report-html.test.ts）が担い、ここでは実際のブラウザで、
 * 書き出しのダイアログから保存したファイルの中身・Mermaid の図を描いて入れること・PDF の印刷が開くことを見る。
 * PDF はブラウザの印刷のダイアログを自動で操作できないため、`print` をブラウザの API の境界で差し替え、
 * 呼ばれたことと、印刷する文書（iframe の中）がレポートであることを確かめる。
 * スライドの分け方・安全策は UT（slides.test.ts・report-slides.test.ts）が担い、ここでは応答の「保存」から保存した
 * ファイルの中身と、そのファイルをブラウザで開いてキーで 1 枚ずつ進めること（scroll-snap）を見る。
 * PPTX の割り付け（続きのスライド・図形の位置）は UT（pptx-layout.test.ts・report-pptx.test.ts）が担い、ここでは
 * 実際のブラウザで pptxgenjs を読み込んで保存したファイルの中身（スライド・タイトル・図の画像）を見る。
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

/** スライドの形で書いた応答（表紙・区切り線で 3 枚） */
const SLIDES_ANSWER = [
  '# 提案',
  '',
  '副題',
  '',
  '---',
  '',
  '## 背景',
  '',
  '- 1',
  '- 2',
  '',
  '---',
  '',
  '## まとめ',
  '',
  '本文',
].join('\n');

/**
 * 応答の「保存」のダイアログでスライドを選び、保存されたファイルを受け取る。
 *
 * @param page - 対象のページ
 * @returns ダウンロード
 */
async function saveSlides(page: Page) {
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '応答を保存' });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: /^スライド/ }).click(),
  ]);
  return download;
}

/**
 * スライドの上端の、画面の上端からの位置（px。四捨五入）を返す。
 *
 * @param page - スライドを開いたページ
 * @param index - スライドの番号（1 始まり）
 * @returns 上端の位置
 */
async function slideTop(page: Page, index: number) {
  return page.evaluate(
    (id) =>
      Math.round(
        document.getElementById(id)?.getBoundingClientRect().top ?? NaN
      ),
    `slide-${index}`
  );
}

test.describe('HTML スライドの書き出し', () => {
  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('応答の「保存」でスライドを選ぶと、区切り線ごとのスライドが 1 ファイルで保存される', async ({
      page,
      request,
    }) => {
      await createReportConversation(request, SLIDES_ANSWER);
      await openConversation(page);

      const download = await saveSlides(page);

      expect(download.suggestedFilename()).toMatch(
        /^レポートの会話_\d{4}-\d{2}-\d{2}_\d{4}\.slides\.html$/
      );
      const html = await readDownload(download);
      expect(html.startsWith('<!doctype html>')).toBe(true);
      expect(html.match(/<section class="slide/g)).toHaveLength(3);
      expect(html).toContain('<section class="slide cover" id="slide-1">');
      expect(html).toContain('<h2>背景</h2>');
      expect(html).toContain('<span class="slide-number">3 / 3</span>');
      // 応答 1 件なので、質問は入らない
      expect(html).not.toContain('この画像について教えて');
      expect(html).not.toMatch(/<script/i);
      await expect(
        page.getByRole('dialog', { name: '応答を保存' })
      ).toBeHidden();
    });

    test('保存したスライドをブラウザで開くと、スペース・Page Down で 1 枚ずつ止まって進む', async ({
      page,
      request,
    }) => {
      await createReportConversation(request, SLIDES_ANSWER);
      await openConversation(page);
      const html = await readDownload(await saveSlides(page));

      await page.setContent(html);
      await expect(page.locator('#slide-1 h1')).toHaveText('提案');
      expect(await slideTop(page, 1)).toBe(0);

      await page.keyboard.press('Space');
      await expect.poll(() => slideTop(page, 2)).toBe(0);
      await page.keyboard.press('PageDown');
      await expect.poll(() => slideTop(page, 3)).toBe(0);
    });

    test('スライドの Mermaid の図は描いた SVG を <img> で入れる', async ({
      page,
      request,
    }) => {
      await createReportConversation(
        request,
        '## 図\n\n```mermaid\ngraph TD; A-->B\n```'
      );
      await openConversation(page);

      const html = await readDownload(await saveSlides(page));

      expect(html).toContain('<img src="data:image/svg+xml');
      expect(html).not.toContain('language-mermaid');
    });
  });

  test.describe('準正常系', () => {
    test('会話の書き出しのダイアログには、スライドを出さない', async ({
      page,
      request,
    }) => {
      await createReportConversation(request, SLIDES_ANSWER);
      await openConversation(page);

      await page.getByRole('button', { name: '会話を書き出す' }).click();
      const dialog = page.getByRole('dialog', { name: '会話を書き出す' });
      await expect(dialog.getByRole('button', { name: /^HTML/ })).toBeVisible();
      await expect(
        dialog.getByRole('button', { name: /^スライド/ })
      ).toHaveCount(0);
    });

    test('PlantUML の図を描けなければ、ソースのコードブロックのままスライドに入れる', async ({
      page,
      request,
    }) => {
      await page.route('**/api/diagrams/plantuml', (route) =>
        route.fulfill({ status: 502, json: { error: 'PlantUML の失敗' } })
      );
      await createReportConversation(
        request,
        '## 図\n\n```plantuml\n@startuml\nA -> B\n@enduml\n```'
      );
      await openConversation(page);

      const html = await readDownload(await saveSlides(page));

      expect(html).toContain('language-plantuml');
      expect(html).toContain('@startuml');
    });
  });

  test.describe('異常系', () => {
    test('応答の中の生の HTML・危ない URL は、スライドでも動かない', async ({
      page,
      request,
    }) => {
      await createReportConversation(
        request,
        '## A\n\n<script>alert(1)</script>\n\n[押す](javascript:alert(1))'
      );
      await openConversation(page);

      const html = await readDownload(await saveSlides(page));

      expect(html).not.toMatch(/<script/i);
      expect(html).not.toContain('javascript:');
      expect(html).toContain('<a>押す</a>');
    });
  });
});

/** zip の中のスライドのファイル（`ppt/slides/slide3.xml`） */
const PPTX_SLIDE_FILE = /^ppt\/slides\/slide(\d+)\.xml$/;

/** zip の中の、埋め込んだ画像のファイル（PPTX） */
const PPTX_MEDIA_FILE = /^ppt\/media\/[^/]+\.(?:png|jpe?g)$/;

/** スライド番号の欄（各スライドに置かれる。中の文字は PowerPoint が番号に置き換える） */
const PPTX_SLIDE_NUMBER_FIELD =
  /<a:fld [^>]*type="slidenum"[^>]*>[\s\S]*?<\/a:fld>/g;

/**
 * 応答の「保存」のダイアログで PPTX を選び、保存されたファイルを受け取る。
 *
 * @param page - 対象のページ
 * @returns ダウンロード
 */
async function savePptx(page: Page) {
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '応答を保存' });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: /^PPTX/ }).click(),
  ]);
  return download;
}

/**
 * 保存された PPTX を開き、スライドの XML（番号順）・スライドの関係（リンク先）・ファイル名の一覧を読む。
 *
 * @param download - ダウンロード
 * @returns スライドの XML・関係の XML・zip の中のファイル名
 */
async function readPptx(download: Download) {
  const zip = await JSZip.loadAsync(await readFile(await download.path()));
  const files = Object.keys(zip.files);
  const read = async (name: string) =>
    (await zip.file(name)?.async('string')) ?? '';
  const indexes = files
    .flatMap((name) => {
      const match = PPTX_SLIDE_FILE.exec(name);
      return match ? [Number(match[1])] : [];
    })
    .sort((a, b) => a - b);
  return {
    files,
    slides: await Promise.all(
      indexes.map((i) => read(`ppt/slides/slide${i}.xml`))
    ),
    rels: await Promise.all(
      indexes.map((i) => read(`ppt/slides/_rels/slide${i}.xml.rels`))
    ),
  };
}

/**
 * スライドの XML の文字（`<a:t>`）を、現れた順に取り出す（スライド番号の欄は除く）。
 *
 * @param xml - スライドの XML
 * @returns 文字の並び
 */
function pptxTexts(xml: string): string[] {
  return [
    ...xml
      .replace(PPTX_SLIDE_NUMBER_FIELD, '')
      .matchAll(/<a:t>([^<]*)<\/a:t>/g),
  ].map((m) => m[1]);
}

test.describe('PPTX の書き出し', () => {
  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('応答の「保存」で PPTX を選ぶと、区切り線ごとのスライドの PowerPoint のファイルが保存される', async ({
      page,
      request,
    }) => {
      await createReportConversation(request, SLIDES_ANSWER);
      await openConversation(page);

      const download = await savePptx(page);

      expect(download.suggestedFilename()).toMatch(
        /^レポートの会話_\d{4}-\d{2}-\d{2}_\d{4}\.pptx$/
      );
      const { slides } = await readPptx(download);
      expect(slides).toHaveLength(3);
      expect(pptxTexts(slides[0])).toEqual(['提案', '副題']);
      expect(pptxTexts(slides[1])).toEqual(['背景', '1', '2']);
      expect(pptxTexts(slides[2])).toEqual(['まとめ', '本文']);
      // 各スライドのタイトルは PowerPoint のタイトルの位置に入る
      expect(slides.every((xml) => xml.includes('type="title"'))).toBe(true);
      // 応答 1 件なので、質問は入らない
      expect(slides.join('')).not.toContain('この画像について教えて');
      await expect(
        page.getByRole('dialog', { name: '応答を保存' })
      ).toBeHidden();
    });

    test('Mermaid の図は PNG で埋め込む', async ({ page, request }) => {
      await createReportConversation(
        request,
        '## 図\n\n```mermaid\ngraph TD; A-->B\n```'
      );
      await openConversation(page);

      const { files, slides } = await readPptx(await savePptx(page));

      expect(files.filter((name) => PPTX_MEDIA_FILE.test(name))).toHaveLength(
        1
      );
      expect(slides[0]).toContain('<p:pic>');
      expect(slides[0]).not.toContain('graph TD');
    });
  });

  test.describe('準正常系', () => {
    test('会話の書き出しのダイアログには、PPTX を出さない', async ({
      page,
      request,
    }) => {
      await createReportConversation(request, SLIDES_ANSWER);
      await openConversation(page);

      await page.getByRole('button', { name: '会話を書き出す' }).click();
      const dialog = page.getByRole('dialog', { name: '会話を書き出す' });
      await expect(dialog.getByRole('button', { name: /^DOCX/ })).toBeVisible();
      await expect(dialog.getByRole('button', { name: /^PPTX/ })).toHaveCount(
        0
      );
    });

    test('PlantUML の図を描けなければ、ソースの文字のまま（等幅で）PPTX に入れる', async ({
      page,
      request,
    }) => {
      await page.route('**/api/diagrams/plantuml', (route) =>
        route.fulfill({ status: 502, json: { error: 'PlantUML の失敗' } })
      );
      await createReportConversation(
        request,
        '## 図\n\n```plantuml\n@startuml\nA -> B\n@enduml\n```'
      );
      await openConversation(page);

      const { files, slides } = await readPptx(await savePptx(page));

      expect(pptxTexts(slides[0])).toContain('@startuml');
      expect(slides[0]).toContain('typeface="Consolas"');
      expect(files.some((name) => PPTX_MEDIA_FILE.test(name))).toBe(false);
    });
  });

  test.describe('異常系', () => {
    test('応答の中の生の HTML・危ない URL は、PPTX でも文字のまま・リンクにしない', async ({
      page,
      request,
    }) => {
      await createReportConversation(
        request,
        '## A\n\n<script>alert(1)</script>\n\n[押す](javascript:alert(1))'
      );
      await openConversation(page);

      const { slides, rels } = await readPptx(await savePptx(page));

      expect(pptxTexts(slides[0])).toEqual(
        expect.arrayContaining([
          '&lt;script&gt;alert(1)&lt;/script&gt;',
          '押す',
        ])
      );
      expect(rels.join('')).not.toContain('javascript:');
    });
  });
});
