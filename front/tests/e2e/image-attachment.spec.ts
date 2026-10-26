import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { E2E_OLLAMA_MODEL } from './helpers/model';
import {
  cleanupAllConversations,
  createConversation,
  createMessage,
  fetchMessages,
  fillTextarea,
  waitForResponseComplete,
} from './helpers/test-data';

/**
 * 画像添付の E2E（#6・13-B）。
 *
 * 添付（ファイル選択・ドラッグ＆ドロップ・貼り付け）・ブラウザでの縮小・プレビュー・枚数と形式の検証・
 * 非対応モデルの案内・保存済みの画像の表示と拡大を、実際のブラウザで確かめる。
 * ドラッグ＆ドロップと貼り付けは、`DataTransfer` を組んで `drop` / `paste` のイベントを起こす（アプリのロジックは差し替えない）。
 * CI の E2E のモデル（`qwen2.5:0.5b`）は画像に対応していないため、画像を送って応答を得るテストは
 * 画像に対応したモデル（`/api/models` の `visionModels`）のときだけ走らせ、非対応の案内のテストは逆にする。
 * API の契約（形式の判定・保存・`/api/chat` の画像の扱い）は IT（attachments.test.ts・chat-images.test.ts）が担う。
 */

const TITLE = '画像添付テスト';

/** 添付するファイル（Playwright の `setFiles` に渡す形）。 */
type FilePayload = { name: string; mimeType: string; buffer: Buffer };

/**
 * ブラウザの canvas で塗りつぶしの PNG を作る（テスト用の画像をリポジトリに置かずに済ませる）。
 *
 * @param page - canvas を使うページ（どのページでもよい）
 * @param width - 幅（px）
 * @param height - 高さ（px）
 * @returns PNG の Base64（`data:` の接頭辞なし）
 */
async function pngBase64(
  page: Page,
  width: number,
  height: number
): Promise<string> {
  return page.evaluate(
    ({ w, h }) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      // 2d の context はどのブラウザでも作れる（取れないのは別の種類の context を作った canvas だけ）
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#88c0d0';
      context.fillRect(0, 0, w, h);
      return canvas.toDataURL('image/png').split(',')[1];
    },
    { w: width, h: height }
  );
}

/**
 * 添付する PNG のファイルを作る。
 *
 * @param page - canvas を使うページ
 * @param name - ファイル名
 * @param width - 幅（px）
 * @param height - 高さ（px）
 * @returns ファイル
 */
async function pngFile(
  page: Page,
  name: string,
  width = 64,
  height = 48
): Promise<FilePayload> {
  return {
    name,
    mimeType: 'image/png',
    buffer: Buffer.from(await pngBase64(page, width, height), 'base64'),
  };
}

/**
 * 添付ボタンからファイルを選ぶ。
 *
 * @param page - 対象のページ
 * @param files - 選ぶファイル
 */
async function attachByChooser(page: Page, files: FilePayload[]) {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '画像を添付' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(files);
}

/**
 * ファイルを入れた `DataTransfer` を作る（ドラッグ＆ドロップ・貼り付け用）。
 *
 * @param page - 対象のページ
 * @param width - PNG の幅（px）
 * @param height - PNG の高さ（px）
 * @returns ページの中の `DataTransfer` のハンドル
 */
async function dataTransferWithPng(page: Page, width: number, height: number) {
  return page.evaluateHandle(
    async ({ w, h }) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      // 小さな canvas の PNG 化は失敗しない（toBlob が null を渡すのは大きすぎる canvas だけ）
      canvas.getContext('2d')!.fillRect(0, 0, w, h);
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), 'image/png')
      );
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], 'image.png', { type: 'image/png' }));
      return transfer;
    },
    { w: width, h: height }
  );
}

/**
 * 送信前の添付のサムネイル。
 *
 * @param page - 対象のページ
 * @returns サムネイルの画像のロケーター
 */
function previewImages(page: Page) {
  return page.getByRole('list', { name: '添付した画像' }).getByRole('img');
}

/**
 * 画像の実際の大きさ（読み込んだ画像の `naturalWidth` / `naturalHeight`）を読む。
 *
 * @param page - 対象のページ
 * @param alt - 画像の代替テキスト
 * @returns 幅と高さ
 */
async function naturalSize(page: Page, alt: string) {
  const image = page.getByRole('img', { name: alt, exact: true });
  await expect(image).toHaveJSProperty('complete', true);
  return image.evaluate((element: HTMLImageElement) => ({
    width: element.naturalWidth,
    height: element.naturalHeight,
  }));
}

/**
 * E2E のモデルが画像に対応しているかを、dev サーバーの `/api/models` で確かめる。
 *
 * @param request - Playwright の APIRequestContext
 * @returns 対応していれば true
 */
async function isVisionModel(request: APIRequestContext): Promise<boolean> {
  const res = await request.get('/api/models');
  const data = await res.json();
  return (data.visionModels ?? []).includes(E2E_OLLAMA_MODEL);
}

test.describe('画像添付', () => {
  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('添付ボタンで選んだ画像を選んだ順にプレビューに出し、外せる', async ({
      page,
    }) => {
      await page.goto('/');
      await attachByChooser(page, [
        await pngFile(page, 'wide.png', 400, 100),
        await pngFile(page, 'tall.png', 100, 400),
      ]);

      await expect(previewImages(page)).toHaveCount(2);
      expect(await naturalSize(page, '添付する画像 1')).toEqual({
        width: 400,
        height: 100,
      });

      await page.getByRole('button', { name: '添付する画像 1 を外す' }).click();
      await expect(previewImages(page)).toHaveCount(1);
      // 残った 1 枚が先頭に詰まる
      expect(await naturalSize(page, '添付する画像 1')).toEqual({
        width: 100,
        height: 400,
      });
    });

    test('長辺が 1,280px を超える画像は、縦横比を保って縮小してから添付する', async ({
      page,
    }) => {
      await page.goto('/');
      await attachByChooser(page, [await pngFile(page, 'big.png', 2560, 1440)]);

      expect(await naturalSize(page, '添付する画像 1')).toEqual({
        width: 1280,
        height: 720,
      });
    });

    test('入力欄へのドラッグ＆ドロップと貼り付けで添付できる', async ({
      page,
    }) => {
      await page.goto('/');

      const dropped = await dataTransferWithPng(page, 30, 20);
      const form = page
        .locator('form')
        .filter({ has: page.locator('textarea') });
      await form.dispatchEvent('dragover', { dataTransfer: dropped });
      await form.dispatchEvent('drop', { dataTransfer: dropped });
      await expect(previewImages(page)).toHaveCount(1);

      const pasted = await dataTransferWithPng(page, 20, 30);
      await page.locator('textarea').evaluate(
        (element, clipboardData) =>
          element.dispatchEvent(
            new ClipboardEvent('paste', {
              clipboardData,
              bubbles: true,
              cancelable: true,
            })
          ),
        pasted
      );
      await expect(previewImages(page)).toHaveCount(2);
      expect(await naturalSize(page, '添付する画像 2')).toEqual({
        width: 20,
        height: 30,
      });
    });

    test('保存済みの画像付きの会話を開くと画像を表示し、押すと拡大できる', async ({
      page,
      request,
    }) => {
      // 添付は API で投入する（送信は画像に対応したモデルが要るため。下の送信のテストを参照）
      const conv = await createConversation(request, TITLE);
      const data = await pngBase64(page, 320, 200);
      const save = await request.post(
        `/api/conversations/${conv.id}/messages`,
        {
          data: {
            role: 'user',
            content: 'この画像は？',
            attachments: [
              { id: crypto.randomUUID(), data, width: 320, height: 200 },
            ],
          },
        }
      );
      expect(save.status()).toBe(201);
      await createMessage(request, conv.id, 'assistant', '青い四角です');

      await page.goto('/');
      await page.getByText(TITLE).click();
      await expect(page.getByText('青い四角です')).toBeVisible();
      expect(await naturalSize(page, '添付画像 1')).toEqual({
        width: 320,
        height: 200,
      });

      await page.getByRole('button', { name: '添付画像 1 を拡大' }).click();
      const dialog = page.getByRole('dialog', { name: '添付画像 1' });
      await expect(
        dialog.getByRole('img', { name: '添付画像 1' })
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    });

    test('画像を添付して送ると応答が返り、開き直しても画像が残る', async ({
      page,
      request,
    }) => {
      test.skip(
        !(await isVisionModel(request)),
        'E2E のモデルが画像に対応していない（E2E_OLLAMA_MODEL=qwen3.8:27b などで実行する）'
      );
      test.setTimeout(180000);

      await page.goto('/');
      await attachByChooser(page, [await pngFile(page, 'blue.png', 320, 200)]);
      await expect(previewImages(page)).toHaveCount(1);
      await fillTextarea(page, 'この画像の色を一言で答えてください');
      await page.locator('textarea').press('Enter');

      // 送ると添付は空になり、送ったメッセージに画像が付く
      await expect(previewImages(page)).toHaveCount(0);
      await expect(page.getByRole('img', { name: '添付画像 1' })).toBeVisible();
      await waitForResponseComplete(page, 150000);
      await expect(page.locator('.prose-nord')).toHaveCount(1);

      // 開き直すと、DB に保存した画像を取得 API から表示する
      const conversations = await request.get('/api/conversations');
      const [conv] = (await conversations.json()).conversations;
      const [question] = await fetchMessages(request, conv.id);
      await page.reload();
      await page.getByText(conv.title).click();
      const restored = page.getByRole('img', { name: '添付画像 1' });
      await expect(restored).toHaveAttribute(
        'src',
        new RegExp(`^/api/attachments/[0-9a-f-]{36}$`)
      );
      expect(question.content).toBe('この画像の色を一言で答えてください');
      expect(await naturalSize(page, '添付画像 1')).toEqual({
        width: 320,
        height: 200,
      });
    });
  });

  test.describe('準正常系', () => {
    test('1 メッセージ 4 枚を超える分は添付せず、上限を伝える', async ({
      page,
    }) => {
      await page.goto('/');
      const files = await Promise.all(
        [1, 2, 3, 4, 5].map((n) => pngFile(page, `${n}.png`))
      );
      await attachByChooser(page, files);

      await expect(previewImages(page)).toHaveCount(4);
      await expect(
        page.getByText(
          '画像は1メッセージにつき4枚までです（1枚を添付しませんでした）'
        )
      ).toBeVisible();
    });

    test('画像に対応していないモデルでは案内を出して送信させず、画像を外せば送れる', async ({
      page,
      request,
    }) => {
      test.skip(
        await isVisionModel(request),
        'E2E のモデルが画像に対応しているため、非対応の案内は出ない'
      );

      await page.goto('/');
      await attachByChooser(page, [await pngFile(page, 'a.png')]);
      await fillTextarea(page, 'これは？');

      await expect(
        page.getByText(
          `選択中のモデル（${E2E_OLLAMA_MODEL}）は画像に対応していません`
        )
      ).toBeVisible();
      const send = page.getByRole('button', { name: '送信' });
      await expect(send).toBeDisabled();

      await page.getByRole('button', { name: '添付する画像 1 を外す' }).click();
      await expect(send).toBeEnabled();
    });

    test('本文が空なら、画像だけでは送れない', async ({ page }) => {
      await page.goto('/');
      await attachByChooser(page, [await pngFile(page, 'a.png')]);
      await expect(previewImages(page)).toHaveCount(1);

      await expect(page.getByRole('button', { name: '送信' })).toBeDisabled();
    });
  });

  test.describe('異常系', () => {
    test('画像でないファイル・SVG は添付せず、理由を出す', async ({ page }) => {
      await page.goto('/');
      await attachByChooser(page, [
        {
          name: 'memo.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('hello'),
        },
        {
          name: 'icon.svg',
          mimeType: 'image/svg+xml',
          buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
        },
      ]);

      // Next の開発サーバーも role="alert" の要素（ルートの読み上げ）を置くため、文言で探す
      await expect(
        page.getByText('「memo.txt」は添付できない形式です', { exact: false })
      ).toBeVisible();
      await expect(
        page.getByText('「icon.svg」は添付できない形式です', { exact: false })
      ).toBeVisible();
      await expect(
        page.getByRole('list', { name: '添付した画像' })
      ).toHaveCount(0);
    });

    test('中身の壊れた画像は、読み込めないことを伝えて添付しない', async ({
      page,
    }) => {
      await page.goto('/');
      await attachByChooser(page, [
        {
          name: 'broken.png',
          mimeType: 'image/png',
          buffer: Buffer.from('this is not a png'),
        },
      ]);

      await expect(
        page.getByText('「broken.png」を画像として読み込めませんでした')
      ).toBeVisible();
      await expect(
        page.getByRole('list', { name: '添付した画像' })
      ).toHaveCount(0);
    });
  });
});
