import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import {
  cleanupAllConversations,
  createConversation,
  createMessage,
} from './helpers/test-data';

/**
 * コードブロックのシンタックスハイライトと言語名ラベルの E2E（#144）。
 *
 * 応答は API で投入する（モデルの出力にどの言語のコードブロックが含まれるかは決まらず、
 * ハイライトの検証はモデルに依存しないため。軽量モデル・CI でも動く）。
 * 言語名の取り出しの分岐は UT（code-block.test.ts）が担い、ここでは描画（色・ラベル・XSS 耐性）を見る。
 */

const TITLE = 'ハイライトの検証';
/** テーマの保存先（`useTheme` の localStorage キー） */
const THEME_STORAGE_KEY = 'nordic-chat-theme';

/**
 * 応答を 1 件持つ会話を投入して開く。
 *
 * @param page - 対象のページ
 * @param request - API 呼び出しに使うリクエストコンテキスト
 * @param answer - 応答の Markdown の原文
 * @param visibleText - 開いたことの確認に使う、応答内の文字列
 */
async function openAnswer(
  page: Page,
  request: APIRequestContext,
  answer: string,
  visibleText: string
) {
  const conv = await createConversation(request, TITLE);
  await createMessage(request, conv.id, 'user', 'コードを見せてください');
  await createMessage(request, conv.id, 'assistant', answer);

  await page.goto('/');
  await page.getByText(TITLE).click();
  await expect(page.locator('main pre').getByText(visibleText)).toBeVisible();
}

/**
 * Markdown のコードブロックを組み立てる。
 *
 * @param language - コードフェンスに書く言語名（空文字なら指定なし）
 * @param lines - コードの各行
 * @returns コードブロックの Markdown
 */
function fence(language: string, lines: string[]) {
  return ['```' + language, ...lines, '```'].join('\n');
}

/**
 * 要素の文字色（計算後の値）を返す。
 *
 * @param locator - 対象の要素
 * @returns `rgb(...)` 形式の文字色
 */
function colorOf(locator: Locator) {
  return locator.evaluate((el) => getComputedStyle(el).color);
}

/**
 * テーマ変数の値を、文字色として解決した形（`rgb(...)`）で返す。
 *
 * @param page - 対象のページ
 * @param variable - CSS 変数名（例: `--color-nord-frost-2`）
 * @returns 変数が指す色。変数が定義されていなければ継承色になる
 */
function themeColor(page: Page, variable: string) {
  return page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, variable);
}

const TS_CODE = fence('typescript', [
  '// 挨拶を返す',
  'const greeting: string = "Hello";',
  'const count = 42;',
]);

test.describe('シンタックスハイライト', () => {
  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('言語を指定したコードブロックはトークンごとにテーマの色で表示され、右上に言語名が出る', async ({
      page,
      request,
    }) => {
      await openAnswer(page, request, TS_CODE, '"Hello"');
      const code = page.locator('main pre code');

      await expect(page.getByTestId('code-language')).toHaveText('typescript');
      const keyword = code.locator('.hljs-keyword').first();
      const string = code.locator('.hljs-string');
      const number = code.locator('.hljs-number');
      const comment = code.locator('.hljs-comment');
      await expect(keyword).toHaveText('const');
      await expect(string).toHaveText('"Hello"');
      await expect(number).toHaveText('42');
      await expect(comment).toHaveText('// 挨拶を返す');

      // 色は既定テーマ（Nord）の変数から付く。地の文字色とも区別される
      expect(await colorOf(keyword)).toBe(
        await themeColor(page, '--color-nord-frost-2')
      );
      expect(await colorOf(string)).toBe(
        await themeColor(page, '--color-nord-aurora-green')
      );
      // ハイライト専用に足した変数も既定テーマで定義されている
      expect(await colorOf(number)).toBe('rgb(180, 142, 173)');
      expect(await colorOf(keyword)).not.toBe(await colorOf(code));
    });

    test('テーマを切り替えると、ハイライトの色もそのテーマの色になる', async ({
      page,
      request,
    }) => {
      await openAnswer(page, request, TS_CODE, '"Hello"');
      const keyword = page.locator('main pre code .hljs-keyword').first();
      const number = page.locator('main pre code .hljs-number');
      const nordKeyword = await colorOf(keyword);

      await page.evaluate(
        (key) => localStorage.setItem(key, 'ocean'),
        THEME_STORAGE_KEY
      );
      await page.reload();
      await page.getByText(TITLE).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'ocean');

      expect(await colorOf(keyword)).not.toBe(nordKeyword);
      expect(await colorOf(keyword)).toBe(
        await themeColor(page, '--color-nord-frost-2')
      );
      expect(await colorOf(number)).toBe('rgb(210, 168, 255)');

      await page.evaluate(
        (key) => localStorage.removeItem(key),
        THEME_STORAGE_KEY
      );
    });
  });

  test.describe('準正常系', () => {
    test('言語を指定しないコードブロックは色付けせず、言語名も出さない（インラインコードの見た目にもしない）', async ({
      page,
      request,
    }) => {
      await openAnswer(
        page,
        request,
        fence('', ['name: app', 'port: 3000']),
        'port: 3000'
      );
      const code = page.locator('main pre code');

      await expect(page.getByTestId('code-language')).toHaveCount(0);
      await expect(code.locator('[class*="hljs-"]')).toHaveCount(0);
      expect(
        await code.evaluate((el) => getComputedStyle(el).borderTopWidth)
      ).toBe('0px');
      expect(await colorOf(code)).toBe(
        await themeColor(page, '--color-nord-6')
      );
    });

    test('highlight.js に無い言語は色付けせずに本文を表示し、言語名は出す', async ({
      page,
      request,
    }) => {
      await openAnswer(
        page,
        request,
        fence('mermaid', ['graph TD', '  A --> B']),
        'A --> B'
      );

      await expect(page.getByTestId('code-language')).toHaveText('mermaid');
      await expect(page.locator('main pre code [class*="hljs-"]')).toHaveCount(
        0
      );
    });

    test('文中のインラインコードは従来どおりの見た目で、色付けもラベルも付かない', async ({
      page,
      request,
    }) => {
      const conv = await createConversation(request, TITLE);
      await createMessage(request, conv.id, 'user', '質問');
      await createMessage(
        request,
        conv.id,
        'assistant',
        '`pnpm dev` で起動します。'
      );
      await page.goto('/');
      await page.getByText(TITLE).click();

      const inline = page.locator('main code', { hasText: 'pnpm dev' });
      await expect(inline).toBeVisible();
      expect(
        await inline.evaluate((el) => getComputedStyle(el).borderTopWidth)
      ).toBe('1px');
      await expect(inline.locator('[class*="hljs-"]')).toHaveCount(0);
      await expect(page.getByTestId('code-language')).toHaveCount(0);
    });
  });

  test.describe('異常系', () => {
    test('HTML のコードブロック内のタグは実行されず、色付きの文字として表示される', async ({
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
        fence('html', [
          '<img src="x" onerror="alert(1)">',
          '<script>alert(2)</script>',
        ]),
        'alert(2)'
      );
      const code = page.locator('main pre code');

      await expect(code.locator('.hljs-name').first()).toHaveText('img');
      // タグは要素として作られず、文字のまま
      await expect(code.locator('img, script')).toHaveCount(0);
      await expect(code).toContainText('<script>alert(2)</script>');
      expect(dialogOpened).toBe(false);
    });

    test('閉じていないコードフェンス（生成途中・途切れた応答）でも画面を壊さずに色付けする', async ({
      page,
      request,
    }) => {
      await openAnswer(
        page,
        request,
        ['途中で切れた応答です。', '', '```python', 'def hello():'].join('\n'),
        'hello'
      );

      await expect(page.getByTestId('code-language')).toHaveText('python');
      await expect(
        page.locator('main pre code .hljs-keyword').first()
      ).toHaveText('def');
      await expect(page.getByText('途中で切れた応答です。')).toBeVisible();
    });
  });
});
