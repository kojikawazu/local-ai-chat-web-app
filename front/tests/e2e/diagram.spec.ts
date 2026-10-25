import { readFile } from 'node:fs/promises';
import type {
  APIRequestContext,
  Download,
  Locator,
  Page,
} from '@playwright/test';
import { test, expect } from '@playwright/test';
import {
  cleanupAllConversations,
  createConversation,
  createMessage,
  sendMessage,
} from './helpers/test-data';

/**
 * Mermaid・PlantUML のコードブロックを図として描く E2E（#169・#171）と、描けた図の拡大・保存・
 * ソースとの切り替え（#176）。
 *
 * 保存済みの応答は API で投入する（モデルが Mermaid を出すかは決まらず、描画の検証はモデルに依存しないため。
 * 軽量モデル・CI でも動く）。生成中の応答だけは `page.route` で `/api/chat` の応答を差し替える（通信の境界の障害注入）。
 * data: URI・SVG の大きさ・テーマの色の組み立て・倍率の段階・保存の背景・PNG の大きさは UT（diagram.test.ts）が担い、
 * ここでは描画・追従・XSS 耐性と、ダイアログの操作・保存したファイルの中身を見る。
 *
 * PlantUML は実際の PlantUML サーバー（docker compose の plantuml。CI は services）で描く。開始前に
 * `global-setup.ts` が繋がることを確かめる。API のエラーの契約は IT（plantuml.test.ts）が担う。
 */

const TITLE = '図の検証';
/** テーマの保存先（`useTheme` の localStorage キー） */
const THEME_STORAGE_KEY = 'nordic-chat-theme';
/** 図の `<img>` の src の接頭辞（`svgToDataUri`） */
const DATA_URI_PREFIX = 'data:image/svg+xml;charset=utf-8,';
/** mermaid の読み込みと描画を待つ上限（ms）。初回はチャンクの取得とコンパイルが走る */
const RENDER_TIMEOUT_MS = 30000;

/**
 * Markdown の図のコードブロックを組み立てる。
 *
 * @param lines - 図のソースの各行
 * @param language - コードフェンスに書く言語名（既定は `mermaid`）
 * @returns コードブロックの Markdown
 */
function fence(lines: string[], language = 'mermaid') {
  return ['```' + language, ...lines, '```'].join('\n');
}

const FLOWCHART = fence([
  'graph TD',
  '  A[ユーザー] --> B[Next.js]',
  '  B --> C[Ollama]',
]);

/**
 * 応答を 1 件持つ会話を投入して開く。
 *
 * @param page - 対象のページ
 * @param request - API 呼び出しに使うリクエストコンテキスト
 * @param answer - 応答の Markdown の原文
 */
async function openAnswer(
  page: Page,
  request: APIRequestContext,
  answer: string
) {
  const conv = await createConversation(request, TITLE);
  await createMessage(request, conv.id, 'user', '図を描いてください');
  await createMessage(request, conv.id, 'assistant', answer);

  await page.goto('/');
  await page.getByText(TITLE).click();
  await expect(page.getByText('図を描いてください')).toBeVisible();
}

/**
 * 図の `<img>` を返す。
 *
 * @param page - 対象のページ
 * @returns 図の `<img>` のロケーター
 */
function diagrams(page: Page) {
  return page.getByTestId('diagram-image');
}

/**
 * 図の `<img>` の src から SVG の文字列に戻す。
 *
 * @param diagram - 図の `<img>`
 * @returns SVG の文字列
 */
async function svgOf(diagram: Locator) {
  const src = (await diagram.getAttribute('src')) ?? '';
  expect(src.startsWith(DATA_URI_PREFIX)).toBe(true);
  return decodeURIComponent(src.slice(DATA_URI_PREFIX.length));
}

/**
 * テーマの CSS 変数の値（`globals.css` に書いたままの形）を返す。
 *
 * @param page - 対象のページ
 * @param variable - CSS 変数名（例: `--color-nord-2`）
 * @returns 変数の値
 */
function themeValue(page: Page, variable: string) {
  return page.evaluate(
    (name) =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    variable
  );
}

test.describe('Mermaid の図', () => {
  test.beforeEach(async ({ page, request }) => {
    await cleanupAllConversations(request);
    // 前のテストのテーマを持ち越さない
    await page.addInitScript(
      (key) => localStorage.removeItem(key),
      THEME_STORAGE_KEY
    );
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

    test('保存済みの応答の Mermaid は図の img で表示され、見出し行の言語名とソースのコピーは残る', async ({
      page,
      request,
    }) => {
      await openAnswer(page, request, FLOWCHART);

      const diagram = diagrams(page);
      await expect(diagram).toBeVisible({ timeout: RENDER_TIMEOUT_MS });
      await expect(diagram).toHaveAttribute('alt', 'Mermaid の図');
      const svg = await svgOf(diagram);
      expect(svg).toContain('ユーザー');
      expect(svg).toContain('Ollama');
      // ソースの pre は図に置き換わる
      await expect(page.locator('main pre')).toHaveCount(0);
      // 図は画像として元の大きさを持つ（既定の 300×150 ではない）
      const size = await diagram.evaluate((img: HTMLImageElement) => ({
        width: img.naturalWidth,
        height: img.naturalHeight,
      }));
      expect(size).not.toEqual({ width: 300, height: 150 });
      expect(size.height).toBeGreaterThan(size.width);

      await expect(page.getByTestId('code-language')).toHaveText('mermaid');
      await page.getByRole('button', { name: 'コードをコピー' }).click();
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toBe(
        'graph TD\n  A[ユーザー] --> B[Next.js]\n  B --> C[Ollama]'
      );
    });

    test('1 つの応答に図が 2 つあっても、両方を描く', async ({
      page,
      request,
    }) => {
      await openAnswer(
        page,
        request,
        [
          FLOWCHART,
          '次はシーケンス図です。',
          fence([
            'sequenceDiagram',
            '  Browser->>API: POST /api/chat',
            '  API-->>Browser: NDJSON',
          ]),
        ].join('\n\n')
      );

      await expect(diagrams(page)).toHaveCount(2, {
        timeout: RENDER_TIMEOUT_MS,
      });
      expect(await svgOf(diagrams(page).nth(0))).toContain('Next.js');
      expect(await svgOf(diagrams(page).nth(1))).toContain('POST /api/chat');
      await expect(page.getByText('次はシーケンス図です。')).toBeVisible();
    });

    test('テーマを切り替えると、図をそのテーマの色で描き直す', async ({
      page,
      request,
    }) => {
      await openAnswer(page, request, FLOWCHART);
      const diagram = diagrams(page);
      await expect(diagram).toBeVisible({ timeout: RENDER_TIMEOUT_MS });
      const nordicSvg = await svgOf(diagram);
      expect(nordicSvg).toContain(await themeValue(page, '--color-nord-2'));

      await page.getByLabel('設定を開く').click();
      await page.getByRole('button', { name: /Midnight Ocean/ }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'ocean');

      const oceanNode = await themeValue(page, '--color-nord-2');
      await expect
        .poll(() => svgOf(diagram), { timeout: RENDER_TIMEOUT_MS })
        .toContain(oceanNode);
      expect(nordicSvg).not.toContain(oceanNode);
    });

    test('生成中の応答の Mermaid は、生成が終わると図になる', async ({
      page,
    }) => {
      await page.route('**/api/chat', (route) =>
        route.fulfill({
          contentType: 'text/plain; charset=utf-8',
          body: `構成図です。\n\n${FLOWCHART}`,
        })
      );
      await page.goto('/');
      await sendMessage(page, '構成図を描いてください');

      await expect(page.getByText('構成図です。')).toBeVisible();
      const diagram = diagrams(page);
      await expect(diagram).toBeVisible({ timeout: RENDER_TIMEOUT_MS });
      expect(await svgOf(diagram)).toContain('Next.js');
    });
  });

  test.describe('準正常系', () => {
    test('構文に誤りがあると、ソースをそのまま表示して描けなかったことを添える', async ({
      page,
      request,
    }) => {
      await openAnswer(
        page,
        request,
        fence(['graph TD', '  A --> ', '  これは図ではない ]]'])
      );

      const error = page.getByTestId('diagram-error');
      await expect(error).toBeVisible({ timeout: RENDER_TIMEOUT_MS });
      await expect(error).toContainText('図を描けませんでした');
      await expect(page.locator('main pre')).toContainText('これは図ではない');
      await expect(diagrams(page)).toHaveCount(0);
    });

    test('空の Mermaid のブロックは描かず、エラーも出さない', async ({
      page,
      request,
    }) => {
      await openAnswer(page, request, `空の図です。\n\n${fence([])}`);

      await expect(page.getByText('空の図です。')).toBeVisible();
      await expect(page.getByTestId('code-language')).toHaveText('mermaid');
      // 描画は非同期のため、描かないこと（エラーも出ないこと）は少し待ってから確かめる
      await page.waitForTimeout(1000);
      await expect(diagrams(page)).toHaveCount(0);
      await expect(page.getByTestId('diagram-error')).toHaveCount(0);
    });

    test('言語名が大文字（Mermaid）でも図として描く', async ({
      page,
      request,
    }) => {
      await openAnswer(
        page,
        request,
        fence(['graph LR', '  X --> Y'], 'Mermaid')
      );

      await expect(diagrams(page)).toBeVisible({ timeout: RENDER_TIMEOUT_MS });
      await expect(page.getByTestId('code-language')).toHaveText('Mermaid');
    });
  });

  test.describe('異常系', () => {
    test('ラベルの HTML・click 文のスクリプトは実行されない', async ({
      page,
      request,
    }) => {
      let dialogOpened = false;
      page.on('dialog', async (dialog) => {
        dialogOpened = true;
        await dialog.dismiss();
      });

      await openAnswer(
        page,
        request,
        fence([
          'graph TD',
          '  A["<img src=x onerror=window.__xss=1>"] --> B[安全]',
          '  click B call alert(1)',
          '  click A "javascript:alert(2)"',
        ])
      );

      const diagram = diagrams(page);
      await expect(diagram).toBeVisible({ timeout: RENDER_TIMEOUT_MS });
      await diagram.click();

      expect(dialogOpened).toBe(false);
      expect(
        await page.evaluate(() => (window as Window & { __xss?: number }).__xss)
      ).toBeUndefined();
      // ラベルの img が DOM の要素として作られていない（図は 1 枚の img のまま）
      await expect(page.locator('main img[src="x"]')).toHaveCount(0);
    });

    test('描けない図があっても、同じ応答の他の図と本文は表示される', async ({
      page,
      request,
    }) => {
      await openAnswer(
        page,
        request,
        [
          fence(['これは図ではない']),
          '壊れた図の後の本文です。',
          FLOWCHART,
        ].join('\n\n')
      );

      await expect(page.getByTestId('diagram-error')).toBeVisible({
        timeout: RENDER_TIMEOUT_MS,
      });
      await expect(diagrams(page)).toHaveCount(1);
      await expect(page.getByText('壊れた図の後の本文です。')).toBeVisible();
    });
  });
});

/** PlantUML のシーケンス図（`@startuml` 付き） */
const SEQUENCE = fence(
  [
    '@startuml',
    'Alice -> Bob : こんにちは',
    'Bob --> Alice : NDJSON',
    '@enduml',
  ],
  'plantuml'
);

test.describe('PlantUML の図', () => {
  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('保存済みの応答の PlantUML は図の img で表示され、ソースの pre は図に置き換わる', async ({
      page,
      request,
    }) => {
      await openAnswer(page, request, SEQUENCE);

      const diagram = diagrams(page);
      await expect(diagram).toBeVisible({ timeout: RENDER_TIMEOUT_MS });
      await expect(diagram).toHaveAttribute('alt', 'PlantUML の図');
      const svg = await svgOf(diagram);
      expect(svg).toContain('Alice');
      expect(svg).toContain('こんにちは');
      await expect(page.locator('main pre')).toHaveCount(0);
      await expect(page.getByTestId('code-language')).toHaveText('plantuml');
    });

    test('@startuml を書かない puml のブロックも図として描く', async ({
      page,
      request,
    }) => {
      await openAnswer(
        page,
        request,
        fence(['Browser -> API : POST /api/chat'], 'puml')
      );

      const diagram = diagrams(page);
      await expect(diagram).toBeVisible({ timeout: RENDER_TIMEOUT_MS });
      expect(await svgOf(diagram)).toContain('POST /api/chat');
    });
  });

  test.describe('準正常系', () => {
    test('構文に誤りがあると、ソースをそのまま表示して PlantUML の理由と行番号を添える', async ({
      page,
      request,
    }) => {
      await openAnswer(
        page,
        request,
        fence(
          ['@startuml', 'Alice -> : ]]', 'これは図ではない (', '@enduml'],
          'plantuml'
        )
      );

      const error = page.getByTestId('diagram-error');
      await expect(error).toBeVisible({ timeout: RENDER_TIMEOUT_MS });
      await expect(error).toContainText('図を描けませんでした');
      await expect(error).toContainText('行目');
      await expect(page.locator('main pre')).toContainText('これは図ではない');
      await expect(diagrams(page)).toHaveCount(0);
    });

    test('空の PlantUML のブロックは描かず、エラーも出さない', async ({
      page,
      request,
    }) => {
      await openAnswer(
        page,
        request,
        `空の図です。\n\n${fence([], 'plantuml')}`
      );

      await expect(page.getByText('空の図です。')).toBeVisible();
      // 描画は非同期のため、描かないこと（エラーも出ないこと）は少し待ってから確かめる
      await page.waitForTimeout(1000);
      await expect(diagrams(page)).toHaveCount(0);
      await expect(page.getByTestId('diagram-error')).toHaveCount(0);
    });
  });

  test.describe('異常系', () => {
    test('外部の URL の include は PlantUML サーバーの SANDBOX で止まり、図にならない', async ({
      page,
      request,
    }) => {
      await openAnswer(
        page,
        request,
        fence(
          [
            '@startuml',
            '!include https://example.com/x.puml',
            'Alice -> Bob',
            '@enduml',
          ],
          'plantuml'
        )
      );

      const error = page.getByTestId('diagram-error');
      await expect(error).toBeVisible({ timeout: RENDER_TIMEOUT_MS });
      await expect(error).toContainText('Cannot open URL');
      await expect(diagrams(page)).toHaveCount(0);
    });

    test('PlantUML の API が失敗しても、ソースと理由を出し、同じ応答の Mermaid と本文は表示される', async ({
      page,
      request,
    }) => {
      // サーバーが落ちた状態は実環境で安定して作れないため、通信の境界で 502 を注入する
      await page.route('**/api/diagrams/plantuml', (route) =>
        route.fulfill({
          status: 502,
          json: { error: 'テスト用の PlantUML の接続エラーです' },
        })
      );
      await openAnswer(
        page,
        request,
        [SEQUENCE, 'PlantUML の後の本文です。', FLOWCHART].join('\n\n')
      );

      const error = page.getByTestId('diagram-error');
      await expect(error).toBeVisible({ timeout: RENDER_TIMEOUT_MS });
      await expect(error).toContainText('テスト用の PlantUML の接続エラーです');
      // Mermaid は描画が終わるまでソースの pre が残るため、図を待ってから PlantUML のソースを確かめる
      await expect(diagrams(page)).toHaveCount(1, {
        timeout: RENDER_TIMEOUT_MS,
      });
      await expect(diagrams(page)).toHaveAttribute('alt', 'Mermaid の図');
      await expect(page.locator('main pre')).toHaveCount(1);
      await expect(page.locator('main pre')).toContainText('Alice -> Bob');
      await expect(page.getByText('PlantUML の後の本文です。')).toBeVisible();
    });
  });
});

/** PNG のファイルの先頭の 8 バイト（シグネチャ） */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** 保存のファイル名（`buildExportFileName` の `<種類>_<YYYY-MM-DD>_<HHmm>.<拡張子>`） */
const fileNamePattern = (kind: string, extension: string) =>
  new RegExp(`^${kind}_\\d{4}-\\d{2}-\\d{2}_\\d{4}\\.${extension}$`);

/**
 * 図を描き終えるのを待ってから、拡大のダイアログを開く。
 *
 * @param page - 対象のページ
 * @param title - ダイアログの名前（`Mermaid の図` 等）
 * @returns ダイアログのロケーター
 */
async function openZoomDialog(page: Page, title: string) {
  await expect(diagrams(page)).toBeVisible({ timeout: RENDER_TIMEOUT_MS });
  await page.getByRole('button', { name: '図を拡大' }).click();
  const dialog = page.getByRole('dialog', { name: title });
  await expect(dialog).toBeVisible();
  // 図の元の大きさが読めるまで、保存・倍率の操作は押せない
  await expect(dialog.getByRole('button', { name: 'PNG' })).toBeEnabled();
  return dialog;
}

/**
 * ダイアログの保存のボタンを押し、ダウンロードを受け取る。
 *
 * @param page - 対象のページ
 * @param dialog - 拡大のダイアログ
 * @param format - 押すボタン（`SVG` / `PNG`）
 * @returns ダウンロード
 */
async function saveAs(page: Page, dialog: Locator, format: 'SVG' | 'PNG') {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: format }).click(),
  ]);
  return download;
}

/**
 * ダウンロードしたファイルの中身を読む。
 *
 * @param download - ダウンロード
 * @returns ファイルの中身
 */
async function readDownload(download: Download) {
  const path = await download.path();
  expect(path).not.toBeNull();
  return readFile(path as string);
}

/**
 * PNG の幅・高さを IHDR（シグネチャの直後のチャンク）から読む。
 *
 * @param png - PNG のファイルの中身
 * @returns 幅と高さ（px）
 */
function pngSize(png: Buffer) {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/**
 * 拡大のダイアログの図の元の大きさを読む。
 *
 * @param dialog - 拡大のダイアログ
 * @returns `naturalWidth` / `naturalHeight`
 */
function naturalSizeOf(dialog: Locator) {
  return dialog
    .getByTestId('diagram-zoom-image')
    .evaluate((img: HTMLImageElement) => ({
      width: img.naturalWidth,
      height: img.naturalHeight,
    }));
}

test.describe('図の拡大・保存・ソースとの切り替え', () => {
  test.beforeEach(async ({ page, request }) => {
    await cleanupAllConversations(request);
    await page.addInitScript(
      (key) => localStorage.removeItem(key),
      THEME_STORAGE_KEY
    );
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('ソースを表示に切り替えるとソースのコードブロックが出て、戻すと図に戻る', async ({
      page,
      request,
    }) => {
      await openAnswer(page, request, FLOWCHART);
      await expect(diagrams(page)).toBeVisible({ timeout: RENDER_TIMEOUT_MS });

      const toggle = page.getByRole('button', { name: 'ソースを表示' });
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('main pre')).toContainText('graph TD');
      await expect(diagrams(page)).toHaveCount(0);

      await toggle.click();
      await expect(diagrams(page)).toBeVisible();
      await expect(page.locator('main pre')).toHaveCount(0);
    });

    test('拡大のダイアログで倍率を変えると図の大きさが変わり、Escape で閉じる', async ({
      page,
      request,
    }) => {
      await openAnswer(page, request, FLOWCHART);
      const dialog = await openZoomDialog(page, 'Mermaid の図');
      const level = dialog.getByTestId('diagram-zoom-level');
      const image = dialog.getByTestId('diagram-zoom-image');
      const natural = await naturalSizeOf(dialog);
      const fit = dialog.getByRole('button', { name: '全体' });
      // 開いたときは「全体」で、そのときの表示の倍率を出す
      await expect(fit).toHaveAttribute('aria-pressed', 'true');
      await expect(level).toHaveText(/^\d+%$/);

      // 「全体」から拡大すると、そのときの表示より大きい段階へ移る（表示の倍率が必ず変わる）
      const fitLevel = await level.textContent();
      await dialog.getByRole('button', { name: '拡大', exact: true }).click();
      await expect(fit).toHaveAttribute('aria-pressed', 'false');
      await expect(level).toHaveText(/^\d+%$/);
      await expect(level).not.toHaveText(fitLevel ?? '');

      await dialog.getByRole('button', { name: '100%' }).click();
      await expect(level).toHaveText('100%');
      expect((await image.boundingBox())?.width).toBeCloseTo(natural.width, 0);

      await dialog.getByRole('button', { name: '拡大', exact: true }).click();
      await expect(level).toHaveText('150%');
      expect((await image.boundingBox())?.width).toBeCloseTo(
        natural.width * 1.5,
        0
      );

      await fit.click();
      await expect(fit).toHaveAttribute('aria-pressed', 'true');
      await expect(level).not.toHaveText('150%');

      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      // 閉じても図はそのまま
      await expect(diagrams(page)).toBeVisible();
    });

    test('Mermaid の図を SVG で保存すると、画面と同じ地の色の背景が付く', async ({
      page,
      request,
    }) => {
      await openAnswer(page, request, FLOWCHART);
      const dialog = await openZoomDialog(page, 'Mermaid の図');
      const background = await themeValue(page, '--color-nord-0');

      const download = await saveAs(page, dialog, 'SVG');
      expect(download.suggestedFilename()).toMatch(
        fileNamePattern('mermaid', 'svg')
      );
      const svg = (await readDownload(download)).toString('utf-8');
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('ユーザー');
      expect(svg).toMatch(
        new RegExp(`<svg[^>]*><rect [^>]*fill="${background}"/>`)
      );
    });

    test('Mermaid の図を PNG で保存すると、元の大きさの 2 倍の PNG になる', async ({
      page,
      request,
    }) => {
      await openAnswer(page, request, FLOWCHART);
      const dialog = await openZoomDialog(page, 'Mermaid の図');
      const natural = await naturalSizeOf(dialog);

      const download = await saveAs(page, dialog, 'PNG');
      expect(download.suggestedFilename()).toMatch(
        fileNamePattern('mermaid', 'png')
      );
      const png = await readDownload(download);
      expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
      expect(pngSize(png)).toEqual({
        width: Math.ceil(natural.width * 2),
        height: Math.ceil(natural.height * 2),
      });
    });

    test('PlantUML の図も SVG・PNG で保存できる', async ({ page, request }) => {
      await openAnswer(page, request, SEQUENCE);
      const dialog = await openZoomDialog(page, 'PlantUML の図');

      const svgDownload = await saveAs(page, dialog, 'SVG');
      expect(svgDownload.suggestedFilename()).toMatch(
        fileNamePattern('plantuml', 'svg')
      );
      const svg = (await readDownload(svgDownload)).toString('utf-8');
      expect(svg).toContain('Alice');

      const pngDownload = await saveAs(page, dialog, 'PNG');
      expect(pngDownload.suggestedFilename()).toMatch(
        fileNamePattern('plantuml', 'png')
      );
      const png = await readDownload(pngDownload);
      expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    });
  });

  test.describe('準正常系', () => {
    test('描けなかった図には、切り替え・拡大のボタンを出さない', async ({
      page,
      request,
    }) => {
      await openAnswer(
        page,
        request,
        fence(['graph TD', '  A --> ', '  これは図ではない ]]'])
      );
      await expect(page.getByTestId('diagram-error')).toBeVisible({
        timeout: RENDER_TIMEOUT_MS,
      });
      await expect(
        page.getByRole('button', { name: 'ソースを表示' })
      ).toHaveCount(0);
      await expect(page.getByRole('button', { name: '図を拡大' })).toHaveCount(
        0
      );
      // コピーは残る
      await expect(
        page.getByRole('button', { name: 'コードをコピー' })
      ).toBeVisible();
    });

    test('倍率の端（400%・25%）では、それ以上の拡大・縮小のボタンを押せない', async ({
      page,
      request,
    }) => {
      await openAnswer(page, request, FLOWCHART);
      const dialog = await openZoomDialog(page, 'Mermaid の図');
      const level = dialog.getByTestId('diagram-zoom-level');
      const zoomIn = dialog.getByRole('button', { name: '拡大', exact: true });
      const zoomOut = dialog.getByRole('button', { name: '縮小' });

      await dialog.getByRole('button', { name: '100%' }).click();
      for (const expected of ['150%', '200%', '300%', '400%']) {
        await zoomIn.click();
        await expect(level).toHaveText(expected);
      }
      await expect(zoomIn).toBeDisabled();

      for (const expected of [
        '300%',
        '200%',
        '150%',
        '100%',
        '75%',
        '50%',
        '25%',
      ]) {
        await zoomOut.click();
        await expect(level).toHaveText(expected);
      }
      await expect(zoomOut).toBeDisabled();
      await expect(zoomIn).toBeEnabled();
    });
  });

  test.describe('異常系', () => {
    test('PNG に変換できなくても、理由を出してダイアログを閉じず、SVG では保存できる', async ({
      page,
      request,
    }) => {
      // ブラウザ API の境界の障害注入: 大きすぎる canvas などで書き出せないときの toBlob（null を渡す）を再現する
      await page.addInitScript(() => {
        HTMLCanvasElement.prototype.toBlob = function (callback) {
          setTimeout(() => callback(null), 0);
        };
      });
      await openAnswer(page, request, FLOWCHART);
      const dialog = await openZoomDialog(page, 'Mermaid の図');

      await dialog.getByRole('button', { name: 'PNG' }).click();
      const error = dialog.getByTestId('diagram-png-error');
      await expect(error).toHaveText(
        'PNG にできませんでした: 画像を書き出せませんでした'
      );
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'PNG' })).toBeEnabled();

      const download = await saveAs(page, dialog, 'SVG');
      expect(download.suggestedFilename()).toMatch(
        fileNamePattern('mermaid', 'svg')
      );
    });
  });
});
