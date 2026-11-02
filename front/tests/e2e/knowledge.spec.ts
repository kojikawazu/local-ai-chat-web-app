import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { E2E_EMBED_MODEL } from './helpers/model';

/**
 * RAG のドキュメントの取り込みと管理の E2E（#17 Phase A。`docs/28-rag.md`「管理画面」）。
 *
 * サイドバーの「ドキュメント」から、ファイルの取り込み（実際の Ollama の埋め込みのモデル）・同じ名前の置き換え・削除・
 * 失敗の表示を確かめる。チャンクの分け方・ファイルの検証は UT、API の契約（上限・作り直し・途中の失敗）は IT が担う。
 * 通信の失敗だけ `page.route` で境界に注入する。
 *
 * 開発の DB を使う。一覧の API は本文を返さず、利用者のドキュメントを控えて戻せないため、テストで作るドキュメントは
 * 名前を {@link PREFIX} で始め、それだけを消す（利用者のドキュメントには触らない）。
 */

const DOCUMENTS_API = '/api/knowledge/documents';

/** テストで作るドキュメントの名前の頭 */
const PREFIX = 'e2e-knowledge-';

/** 見出しで 2 つのチャンクに分かれる Markdown */
const DESIGN_MD = '# 設計\n\n## 範囲\n\n含めるもの\n\n## データ\n\n表の説明\n';

/**
 * テストで作ったドキュメント（名前が {@link PREFIX} で始まるもの）を消す。
 *
 * @param request - Playwright の API クライアント
 */
async function deleteTestDocuments(request: APIRequestContext) {
  const res = await request.get(DOCUMENTS_API);
  expect(res.ok()).toBe(true);
  // 一覧の API の応答（IT で形を確かめている）のうち、使う項目だけの型にする
  const { documents } = (await res.json()) as {
    documents: { id: string; name: string }[];
  };
  for (const document of documents.filter((d) => d.name.startsWith(PREFIX))) {
    await request.delete(`${DOCUMENTS_API}/${document.id}`);
  }
}

/**
 * サイドバーからドキュメントのダイアログを開く。
 *
 * @param page - Playwright のページ
 * @returns ダイアログ
 */
async function openKnowledge(page: Page) {
  await page
    .locator('aside')
    .getByRole('button', { name: 'ドキュメントを開く' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'ドキュメント' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * ダイアログのファイルの選択に、ファイルを渡す（OS のファイルの選択の画面を通さない）。
 *
 * @param dialog - ドキュメントのダイアログ
 * @param files - 渡すファイル（名前と中身）
 */
async function chooseFiles(
  dialog: ReturnType<Page['getByRole']>,
  files: { name: string; content: string | Buffer }[]
) {
  await dialog.getByLabel('取り込むファイル').setInputFiles(
    files.map(({ name, content }) => ({
      name,
      mimeType: 'text/plain',
      buffer: typeof content === 'string' ? Buffer.from(content) : content,
    }))
  );
}

/**
 * ドキュメントの一覧の、名前の行。
 *
 * @param dialog - ドキュメントのダイアログ
 * @param name - ドキュメントの名前
 * @returns 一覧の行
 */
function itemOf(dialog: ReturnType<Page['getByRole']>, name: string) {
  return dialog
    .getByRole('list', { name: 'ドキュメントの一覧' })
    .getByRole('listitem', { name });
}

test.describe('RAG のドキュメント', () => {
  test.beforeEach(async ({ request }) => {
    await deleteTestDocuments(request);
  });

  test.afterAll(async ({ request }) => {
    await deleteTestDocuments(request);
  });

  test.describe('正常系', () => {
    test('選んだファイルを取り込み、一覧に大きさ・チャンクの数が出る', async ({
      page,
    }) => {
      await page.goto('/');
      const dialog = await openKnowledge(page);
      await expect(
        dialog.getByText(`埋め込みのモデル: ${E2E_EMBED_MODEL}`)
      ).toBeVisible();

      await chooseFiles(dialog, [
        { name: `${PREFIX}設計.md`, content: DESIGN_MD },
        { name: `${PREFIX}メモ.txt`, content: '一行のメモ' },
      ]);

      // 実際の埋め込みのモデルで作るため、初回はモデルの読み込みを待つ
      await expect(itemOf(dialog, `${PREFIX}設計.md`)).toContainText(
        '2 チャンク',
        { timeout: 60_000 }
      );
      await expect(itemOf(dialog, `${PREFIX}メモ.txt`)).toContainText(
        '1 チャンク',
        { timeout: 60_000 }
      );
      await expect(
        dialog.getByRole('list', { name: '取り込み中のファイル' })
      ).toHaveCount(0);

      // 開き直しても残る（DB に保存されている）
      await dialog.getByRole('button', { name: '閉じる' }).first().click();
      const reopened = await openKnowledge(page);
      await expect(itemOf(reopened, `${PREFIX}設計.md`)).toBeVisible();
    });

    test('同じ名前のファイルを取り込むと、1 つのまま置き換わる', async ({
      page,
    }) => {
      await page.goto('/');
      const dialog = await openKnowledge(page);
      const name = `${PREFIX}置き換え.md`;

      await chooseFiles(dialog, [{ name, content: DESIGN_MD }]);
      await expect(itemOf(dialog, name)).toContainText('2 チャンク', {
        timeout: 60_000,
      });

      await chooseFiles(dialog, [{ name, content: '書き直した本文' }]);
      await expect(itemOf(dialog, name)).toContainText('1 チャンク', {
        timeout: 60_000,
      });
      await expect(itemOf(dialog, name)).toHaveCount(1);
    });

    test('削除は確かめてから消し、やめると残る', async ({ page }) => {
      await page.goto('/');
      const dialog = await openKnowledge(page);
      const name = `${PREFIX}削除.md`;
      await chooseFiles(dialog, [{ name, content: DESIGN_MD }]);
      const item = itemOf(dialog, name);
      await expect(item).toContainText('チャンク', { timeout: 60_000 });

      await item.getByRole('button', { name: '削除', exact: true }).click();
      await item.getByRole('button', { name: 'やめる' }).click();
      await expect(item).toBeVisible();

      await item.getByRole('button', { name: '削除', exact: true }).click();
      await item.getByRole('button', { name: '削除する' }).click();
      await expect(item).toHaveCount(0);

      const res = await page.request.get(DOCUMENTS_API);
      // 一覧の API の応答（IT で形を確かめている）のうち、使う項目だけの型にする
      const { documents } = (await res.json()) as {
        documents: { name: string }[];
      };
      expect(documents.map((d) => d.name)).not.toContain(name);
    });
  });

  test.describe('準正常系', () => {
    test('取り込めない拡張子は送らずに理由を出し、残りのファイルは取り込む', async ({
      page,
    }) => {
      await page.goto('/');
      const dialog = await openKnowledge(page);

      await chooseFiles(dialog, [
        { name: `${PREFIX}資料.pdf`, content: '%PDF-1.7' },
        { name: `${PREFIX}残り.md`, content: DESIGN_MD },
      ]);

      const uploads = dialog.getByRole('list', {
        name: '取り込み中のファイル',
      });
      await expect(
        uploads.getByRole('alert').filter({ hasText: 'のファイルです' })
      ).toBeVisible();
      await expect(itemOf(dialog, `${PREFIX}残り.md`)).toBeVisible({
        timeout: 60_000,
      });
      await expect(itemOf(dialog, `${PREFIX}資料.pdf`)).toHaveCount(0);
    });
  });

  test.describe('異常系', () => {
    test('テキストでない中身は、API の理由を出して取り込まない', async ({
      page,
    }) => {
      await page.goto('/');
      const dialog = await openKnowledge(page);

      await chooseFiles(dialog, [
        {
          name: `${PREFIX}画像.md`,
          content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]),
        },
      ]);

      await expect(
        dialog
          .getByRole('alert')
          .filter({ hasText: 'テキストのファイルではありません' })
      ).toBeVisible();
      await expect(itemOf(dialog, `${PREFIX}画像.md`)).toHaveCount(0);
    });

    test('取り込みの通信が失敗すると理由を出し、ダイアログは使えるまま', async ({
      page,
    }) => {
      await page.route(`**${DOCUMENTS_API}`, (route) =>
        route.request().method() === 'POST'
          ? route.fulfill({
              status: 502,
              json: { error: '埋め込みを作れませんでした（注入）' },
            })
          : route.continue()
      );
      await page.goto('/');
      const dialog = await openKnowledge(page);

      await chooseFiles(dialog, [
        { name: `${PREFIX}失敗.md`, content: DESIGN_MD },
      ]);

      await expect(
        dialog
          .getByRole('alert')
          .filter({ hasText: '埋め込みを作れませんでした（注入）' })
      ).toBeVisible();
      await expect(
        dialog.getByRole('button', { name: 'ファイルを選ぶ' })
      ).toBeEnabled();
    });
  });
});
