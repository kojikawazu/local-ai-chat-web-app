import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import {
  E2E_BROWSER_FIXTURE_ORIGIN,
  E2E_BROWSER_PASSPHRASE,
} from './helpers/browser';
import { IS_LIGHT_MODEL } from './helpers/model';
import {
  cleanupAllConversations,
  createConversation,
  sendMessage,
  waitForResponseComplete,
} from './helpers/test-data';

/**
 * ブラウザのツール（#149。`docs/18-browser-tools.md`）の E2E。
 *
 * dev サーバーには `playwright.config.ts` が `BROWSER_ENABLED` と、確認用のページを配るサーバー（127.0.0.1:3101）を
 * `BROWSER_LOCAL_ORIGINS` として渡す。確認用のページは合言葉を JavaScript で描くため、ブラウザで開かないと読めない。
 * 押すと回数が増える「数える」ボタンを、操作のツール（#149 Phase C）で押させ、承認カードを確かめる。
 * 操作の画面（#200）は、API で保存した会話を開いて確かめ（CI でも動く）、大きいモデルでは承認カードと結果の画像も確かめる。
 * 公開の Web には触れない。ツールの登録は軽量モデル・CI でも確かめる。モデルにツールを呼ばせるテストは、軽量モデルではスキップする。
 * 宛先の判定（転送・ページの中のリクエスト・アプリ自身）と画像の渡し方の契約は IT（chat-agent-browser.test.ts）、
 * 操作の準備・承認・照合の契約は IT（chat-agent-browser-actions.test.ts）が担う。
 */

/**
 * エージェントモードで送信する。
 *
 * @param page - 対象のページ
 * @param text - 送る文章
 */
async function askAgent(page: Page, text: string) {
  await page.addInitScript(() =>
    localStorage.setItem('agent-tools-enabled', 'true')
  );
  await page.goto('/');
  await sendMessage(page, text);
}

/**
 * 承認カード。
 *
 * @param page - 対象のページ
 * @returns 承認カードのロケーター
 */
function approvalCard(page: Page) {
  return page.getByRole('region', { name: 'ツールの実行の承認' });
}

/**
 * ブラウザの canvas で塗りつぶしの JPEG を作る（テスト用の画像をリポジトリに置かずに済ませる）。
 *
 * @param page - canvas を使うページ
 * @param width - 幅（px）
 * @param height - 高さ（px）
 * @returns JPEG の Base64（`data:` の接頭辞なし）
 */
async function jpegBase64(page: Page, width: number, height: number) {
  return page.evaluate(
    ([w, h]) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext('2d');
      if (context) {
        context.fillStyle = '#5e81ac';
        context.fillRect(0, 0, w, h);
      }
      return canvas.toDataURL('image/jpeg').split(',')[1];
    },
    [width, height]
  );
}

/**
 * ブラウザのツールの画面（#200）付きの応答を、API で保存する。画像は添付画像として、記録は metadata に入れる
 * （画面の useChat が応答を保存するときと同じ形）。
 *
 * @param page - 画像を作るページ
 * @param request - API のクライアント
 * @param title - 会話のタイトル
 */
async function saveResponseWithScreenshots(
  page: Page,
  request: APIRequestContext,
  title: string
) {
  const conv = await createConversation(request, title);
  const data = await jpegBase64(page, 320, 200);
  const shot = (kind: 'before' | 'after') => ({
    id: crypto.randomUUID(),
    kind,
    mimeType: 'image/jpeg',
    width: 320,
    height: 200,
  });
  const opened = shot('after');
  const before = {
    ...shot('before'),
    box: { x: 20, y: 40, width: 80, height: 30 },
  };
  const after = shot('after');
  const toolCall = (name: string, screenshots: object[]) => ({
    name,
    arguments: {},
    result: '結果',
    isError: false,
    durationMs: 10,
    contentOffset: 0,
    screenshots,
  });
  await request.post(`/api/conversations/${conv.id}/messages`, {
    data: { role: 'user', content: 'ボタンを押して' },
  });
  const res = await request.post(`/api/conversations/${conv.id}/messages`, {
    data: {
      role: 'assistant',
      content: '押しました',
      metadata: {
        toolCalls: [
          toolCall('browser_navigate', [opened]),
          toolCall('browser_click', [before, after]),
        ],
      },
      attachments: [opened, before, after].map(({ id, width, height }) => ({
        id,
        data,
        width,
        height,
      })),
    },
  });
  expect(res.status()).toBe(201);
}

/** 確認用のページを開いて「数える」ボタンを押させる依頼 */
const CLICK_REQUEST = `browser_navigate で ${E2E_BROWSER_FIXTURE_ORIGIN}/ を開き、「数える」ボタンを browser_click で 1 回押して、押した後の回数を教えてください`;

test.describe('ブラウザのツール', () => {
  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('ブラウザの 6 つのツールが一覧に出る', async ({ request }) => {
      const res = await request.get('/api/tools');
      const names = (await res.json()).tools.map(
        (tool: { name: string }) => tool.name
      );
      expect(names).toEqual(
        expect.arrayContaining([
          'browser_navigate',
          'browser_snapshot',
          'browser_screenshot',
          'browser_click',
          'browser_type',
          'browser_select',
        ])
      );
    });

    test('ボタンを押す前に承認カードに要素が出て、許可すると押した後の回数を答える', async ({
      page,
    }) => {
      test.skip(IS_LIGHT_MODEL, '軽量モデルはツール呼び出しが不安定なため');
      test.setTimeout(300000);

      await askAgent(page, CLICK_REQUEST);
      const card = approvalCard(page);
      await expect(card).toBeVisible({ timeout: 240000 });
      await expect(card).toContainText('ブラウザでクリックします');
      await expect(card).toContainText('手元の開発サーバー');
      // モデルの説明ではなく、参照から引いた実際の要素を出す
      await expect(card.getByLabel('操作する要素')).toHaveText(
        'button "数える"'
      );

      // 操作の前の画面に、押すボタンの枠を重ねて出す（#200）
      await expect(
        card.getByRole('img', { name: 'クリック の操作の前の画面' })
      ).toBeVisible();
      await expect(card.getByTestId('element-box')).toBeVisible();

      await card.getByRole('button', { name: '許可' }).click();
      await waitForResponseComplete(page, 240000);

      await expect(
        page.locator('button', { hasText: 'button "数える"' }).first()
      ).toContainText('✅');
      // 結果の下に、操作の前と後の画面が残る
      await expect(
        page.getByRole('img', { name: 'クリック の後の画面' })
      ).toBeVisible();
      await expect(page.locator('.prose-nord').last()).toContainText('1');
    });

    test('保存した応答を開くと、ツールの結果の下に操作の前と後の画面が出て、前の画面は要素を枠で囲む（#200）', async ({
      page,
      request,
    }) => {
      const title = '画面の確認（E2E）';
      await page.goto('/');
      await saveResponseWithScreenshots(page, request, title);
      await page.reload();
      await page.getByText(title).click();
      await expect(page.getByText('押しました')).toBeVisible();

      // 結果のパネルを開かなくても見える
      const before = page.getByRole('button', {
        name: 'クリック の操作の前の画面 を拡大',
      });
      await expect(before).toBeVisible();
      await expect(before.getByTestId('element-box')).toBeVisible();
      await expect(
        page.getByRole('img', { name: 'クリック の後の画面' })
      ).toBeVisible();
      await expect(page.getByText('操作の前', { exact: true })).toBeVisible();

      // 押すと拡大し、拡大でも枠を出す
      await before.click();
      const dialog = page.getByRole('dialog', {
        name: 'クリック の操作の前の画面',
      });
      await expect(dialog.getByRole('img')).toBeVisible();
      await expect(dialog.getByTestId('element-box')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    });

    test('手元の開発サーバーのページを開き、JavaScript で描いた合言葉を答える', async ({
      page,
    }) => {
      test.skip(IS_LIGHT_MODEL, '軽量モデルはツール呼び出しが不安定なため');
      test.setTimeout(240000);

      await askAgent(
        page,
        `browser_navigate で ${E2E_BROWSER_FIXTURE_ORIGIN}/ を開き、ページに書かれた合言葉を教えてください`
      );
      await waitForResponseComplete(page, 200000);

      await expect(
        page.locator('button', { hasText: 'E2E の確認用のページ' }).first()
      ).toContainText('✅');
      await expect(page.locator('.prose-nord').last()).toContainText(
        E2E_BROWSER_PASSPHRASE
      );
    });
  });

  test.describe('準正常系', () => {
    test('ページを開いただけの結果は、画面に前・後の見出しを付けない（#200）', async ({
      page,
      request,
    }) => {
      const title = '開いただけ（E2E）';
      await page.goto('/');
      await saveResponseWithScreenshots(page, request, title);
      await page.reload();
      await page.getByText(title).click();

      const opened = page.getByRole('img', { name: 'ページを開く の後の画面' });
      await expect(opened).toBeVisible();
      // 見出しは操作（前の画面がある結果）にだけ付く
      await expect(page.getByText('操作の後', { exact: true })).toHaveCount(1);
    });

    test('許可していない手元のサーバーは開かず、設定の仕方が ❌ で出る', async ({
      page,
    }) => {
      test.skip(IS_LIGHT_MODEL, '軽量モデルはツール呼び出しが不安定なため');
      test.setTimeout(240000);

      // 5499 は PostgreSQL（BROWSER_LOCAL_ORIGINS に無い）
      await askAgent(
        page,
        'browser_navigate で http://127.0.0.1:5499/ を開いてください'
      );
      await waitForResponseComplete(page, 200000);

      await expect(
        page.locator('button', { hasText: 'BROWSER_LOCAL_ORIGINS' }).first()
      ).toContainText('❌');
    });

    test('ボタンを押す前の承認カードで拒否すると、押さずに ❌ で出る', async ({
      page,
    }) => {
      test.skip(IS_LIGHT_MODEL, '軽量モデルはツール呼び出しが不安定なため');
      test.setTimeout(300000);

      await askAgent(page, CLICK_REQUEST);
      const card = approvalCard(page);
      await expect(card).toBeVisible({ timeout: 240000 });
      await card.getByRole('button', { name: '拒否' }).click();
      await waitForResponseComplete(page, 240000);

      await expect(
        page.locator('button', { hasText: '拒否されました' }).first()
      ).toContainText('❌');
    });
  });

  test.describe('異常系', () => {
    test('保存した記録の画面の形が合わなければ、画面は出さずに結果だけを出す（#200）', async ({
      page,
      request,
    }) => {
      const title = '壊れた記録（E2E）';
      const conv = await createConversation(request, title);
      await request.post(`/api/conversations/${conv.id}/messages`, {
        data: {
          role: 'assistant',
          content: '開きました',
          metadata: {
            toolCalls: [
              {
                name: 'browser_navigate',
                arguments: {},
                result: '結果',
                isError: false,
                durationMs: 10,
                contentOffset: 0,
                // ID が UUID でない・形式が画像でない記録は読み捨てる
                screenshots: [
                  {
                    id: 'x',
                    kind: 'after',
                    mimeType: 'image/jpeg',
                    width: 1,
                    height: 1,
                  },
                  {
                    id: crypto.randomUUID(),
                    kind: 'after',
                    mimeType: 'image/svg+xml',
                    width: 1,
                    height: 1,
                  },
                ],
              },
            ],
          },
        },
      });

      await page.goto('/');
      await page.getByText(title).click();
      await expect(page.getByText('開きました')).toBeVisible();
      await expect(
        page.locator('button', { hasText: 'ページを開く' }).first()
      ).toContainText('✅');
      await expect(
        page.getByRole('img', { name: 'ページを開く の後の画面' })
      ).toHaveCount(0);
    });

    test('名前を引けないホストは開かず、❌ で出る', async ({ page }) => {
      test.skip(IS_LIGHT_MODEL, '軽量モデルはツール呼び出しが不安定なため');
      test.setTimeout(240000);

      // .invalid は名前を引けないことが決まっている（RFC 2606）。file: の URL はモデルが呼ぶのを断るため、
      // file: を止めることは IT（chat-agent-browser.test.ts）で確かめる
      await askAgent(
        page,
        'browser_navigate で http://nordic-e2e.invalid/ を開いてください'
      );
      await waitForResponseComplete(page, 200000);

      await expect(
        page.locator('button', { hasText: '解決できません' }).first()
      ).toContainText('❌');
    });
  });
});
