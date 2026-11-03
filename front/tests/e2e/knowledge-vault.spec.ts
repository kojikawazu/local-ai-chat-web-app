import { mkdir, rm, writeFile } from 'fs/promises';
import path from 'path';
import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { E2E_VAULT_DIR, E2E_VAULT_NAME } from './helpers/knowledge-vault';
import {
  cleanupAllConversations,
  sendMessage,
  waitForResponseComplete,
} from './helpers/test-data';

/**
 * RAG の保管庫の同期の E2E（#235。`docs/28-rag.md`「保管庫の同期（Phase C）」の「画面」）。
 *
 * `KNOWLEDGE_VAULTS` に渡した OS の一時フォルダ（{@link E2E_VAULT_DIR}。git でないフォルダ）にノートを置き、ドキュメントの
 * ダイアログの「同期」で取り込む（実際の Ollama の埋め込みのモデル）。git の保管庫が main だけを読むこと・差分の計算・
 * パスの検証は IT（knowledge-vaults.test.ts）が担う。通信の失敗だけ `page.route` で境界に注入する。
 *
 * 開発の DB を使う。後片付けは、置いたノートを消してからもう一度同期して、索引を空にする（アプリの API だけで戻す）。
 */

const VAULTS_API = '/api/knowledge/vaults';

/** 置くノート（取り込むもの 2 つと、取り込まないもの 2 つ） */
const NOTES: Record<string, string> = {
  'glacier.md':
    '# グレイシャー計画\n\n## 合言葉\n\nグレイシャー計画の合言葉は「銀色のホッキョクギツネ」である。\n',
  'memo/plan.txt': '計画の会議は毎週木曜日の 10 時に開く。\n',
  '.claude/rules.md': '# エージェントのルール\n',
  'CLAUDE.md': '# エージェントの設定\n',
};

/**
 * 保管庫のノートを置き直す（前のテストの残りを消してから）。
 *
 * @param notes - パス → 中身
 */
async function putNotes(notes: Record<string, string>) {
  await rm(E2E_VAULT_DIR, { recursive: true, force: true });
  await mkdir(E2E_VAULT_DIR, { recursive: true });
  for (const [relativePath, content] of Object.entries(notes)) {
    const full = path.join(E2E_VAULT_DIR, relativePath);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  }
}

/**
 * 保管庫の索引を、今のフォルダの中身にそろえる（API で差分を求め、全部同期する）。後片付けに使う。
 *
 * @param request - Playwright の API クライアント
 */
async function syncByApi(request: APIRequestContext) {
  const planRes = await request.post(`${VAULTS_API}/${E2E_VAULT_NAME}/plan`);
  expect(planRes.ok()).toBe(true);
  // 差分の API の応答（IT で形を確かめている）のうち、使う項目だけの型にする
  const plan = (await planRes.json()) as Record<
    'add' | 'update' | 'rebuild' | 'remove',
    string[]
  >;
  for (const target of [
    ...plan.add,
    ...plan.update,
    ...plan.rebuild,
    ...plan.remove,
  ]) {
    await request.post(`${VAULTS_API}/${E2E_VAULT_NAME}/sync`, {
      data: { path: target },
    });
  }
}

/**
 * ドキュメントのダイアログを開き、E2E の保管庫の行を返す。
 *
 * @param page - Playwright のページ
 * @returns 保管庫の行
 */
async function openVault(page: Page) {
  await page.goto('/');
  await page
    .locator('aside')
    .getByRole('button', { name: 'ドキュメントを開く' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'ドキュメント' });
  const item = dialog.getByRole('listitem', {
    name: `保管庫 ${E2E_VAULT_NAME}`,
  });
  await expect(item).toBeVisible();
  return item;
}

test.describe('RAG の保管庫の同期', () => {
  test.beforeEach(async () => {
    await putNotes(NOTES);
  });

  test.afterAll(async ({ request }) => {
    // ノートを消して同期し、開発の DB の索引を空にする
    await putNotes({});
    await syncByApi(request);
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('「同期」でノートを取り込み、件数と取り込まなかった理由を出し、もう一度押すと変わらない', async ({
      page,
    }) => {
      const item = await openVault(page);
      await expect(item).toContainText('フォルダ');
      await expect(item).toContainText(E2E_VAULT_DIR);

      await item.getByRole('button', { name: '同期' }).click();
      const status = item.getByRole('status');
      await expect(status).toContainText('同期しました（取り込み 2', {
        timeout: 60000,
      });
      // フォルダの保管庫は `.` で始まるフォルダ（.claude）に入らないため数えない（git の保管庫は一覧に出るので数える）
      await expect(item).toContainText(
        '取り込まなかった: エージェントの設定 1'
      );
      await expect(item).toContainText('2 ファイル');

      await item.getByRole('button', { name: '同期' }).click();
      await expect(status).toHaveText(
        '変わったファイルはありません（2 ファイル）'
      );
    });

    test('ノートを書き換え・消してから同期すると、変えた分を取り込み、消した分を索引から消す', async ({
      page,
      request,
    }) => {
      await syncByApi(request);
      await putNotes({
        'glacier.md': `${NOTES['glacier.md']}\n## 追記\n\n合言葉は年に 1 度変える。\n`,
      });

      const item = await openVault(page);
      await item.getByRole('button', { name: '同期' }).click();

      await expect(item.getByRole('status')).toHaveText(
        '同期しました（取り込み 1・削除 1・変わらない 0）',
        { timeout: 60000 }
      );
      await expect(item).toContainText('1 ファイル');
    });

    test('同期したノートを、会話で「ドキュメントを参照」すると出典に出す', async ({
      page,
      request,
    }) => {
      test.skip(
        !!process.env.CI,
        'CI環境(CPU only)ではストリーミング完了まで時間がかかりすぎるためスキップ'
      );
      await syncByApi(request);
      await page.goto('/');
      await page
        .locator('form')
        .getByRole('button', { name: 'ドキュメントを参照', exact: true })
        .click();

      await sendMessage(page, 'グレイシャー計画の合言葉は？');
      await waitForResponseComplete(page);

      await page
        .getByRole('main')
        .getByRole('button', { name: /^参照したドキュメント/ })
        .click();
      await expect(
        page.getByRole('list', { name: '参照したドキュメント' })
      ).toContainText(`${E2E_VAULT_NAME}/glacier.md`);
    });
  });

  test.describe('準正常系', () => {
    test('保管庫が設定されていなければ、KNOWLEDGE_VAULTS の書き方を出す', async ({
      page,
    }) => {
      await page.route(`**${VAULTS_API}`, (route) =>
        route.fulfill({ json: { vaults: [], embeddingModel: 'x' } })
      );
      await page.goto('/');
      await page
        .locator('aside')
        .getByRole('button', { name: 'ドキュメントを開く' })
        .click();

      await expect(
        page.getByRole('dialog', { name: 'ドキュメント' })
      ).toContainText('環境変数 KNOWLEDGE_VAULTS');
    });

    test('設定に無い保管庫は検索に使わないと出し、索引の削除を 2 段階で確かめる', async ({
      page,
    }) => {
      const deleted: string[] = [];
      await page.route(`**${VAULTS_API}`, (route) =>
        route.fulfill({
          json: {
            vaults: [
              {
                name: 'old-notes',
                root: null,
                configured: false,
                source: null,
                error: null,
                documentCount: 3,
                chunkCount: 9,
                needsRebuildCount: 0,
                lastUpdatedAt: '2026-11-01T00:00:00.000Z',
              },
            ],
            embeddingModel: 'x',
          },
        })
      );
      await page.route(`**${VAULTS_API}/old-notes`, async (route) => {
        deleted.push(route.request().method());
        await route.fulfill({ json: { success: true } });
      });
      await page.goto('/');
      await page
        .locator('aside')
        .getByRole('button', { name: 'ドキュメントを開く' })
        .click();
      const item = page.getByRole('listitem', { name: '保管庫 old-notes' });

      await expect(item).toContainText(
        '設定（KNOWLEDGE_VAULTS）に無い保管庫です。検索には使いません'
      );
      await expect(item.getByRole('button', { name: '同期' })).toHaveCount(0);
      await item.getByRole('button', { name: '索引を消す' }).click();
      await item.getByRole('button', { name: 'やめる' }).click();
      expect(deleted).toEqual([]);
      await item.getByRole('button', { name: '索引を消す' }).click();
      await item.getByRole('button', { name: '消す', exact: true }).click();
      await expect.poll(() => deleted).toEqual(['DELETE']);
    });
  });

  test.describe('異常系', () => {
    test('読めない保管庫は理由を出し、同期を押せない', async ({ page }) => {
      await page.route(`**${VAULTS_API}`, (route) =>
        route.fulfill({
          json: {
            vaults: [
              {
                name: 'broken',
                root: '/tmp/broken',
                configured: true,
                source: null,
                error: '既定のブランチ（main・master）が手元にありません',
                documentCount: 0,
                chunkCount: 0,
                needsRebuildCount: 0,
                lastUpdatedAt: null,
              },
            ],
            embeddingModel: 'x',
          },
        })
      );
      await page.goto('/');
      await page
        .locator('aside')
        .getByRole('button', { name: 'ドキュメントを開く' })
        .click();
      const item = page.getByRole('listitem', { name: '保管庫 broken' });

      await expect(item).toContainText(
        '読めません: 既定のブランチ（main・master）が手元にありません'
      );
      await expect(item.getByRole('button', { name: '同期' })).toBeDisabled();
    });

    test('同期の途中で埋め込みを作れなくなったら、理由を出して止める', async ({
      page,
    }) => {
      await page.route(`**${VAULTS_API}/${E2E_VAULT_NAME}/sync`, (route) =>
        route.fulfill({
          status: 502,
          json: {
            error:
              '埋め込みを作れませんでした。Ollama が起動しているか、OLLAMA_EMBED_MODEL が埋め込みのモデルかを確かめてください',
          },
        })
      );
      // 前のテストで同期が済んでいても差分が出るよう、ノートを 1 つ足す
      await writeFile(path.join(E2E_VAULT_DIR, 'new.md'), '# 新しいノート\n');
      const item = await openVault(page);

      await item.getByRole('button', { name: '同期' }).click();

      await expect(item.getByRole('status')).toHaveText(
        '埋め込みを作れませんでした。Ollama が起動しているか、OLLAMA_EMBED_MODEL が埋め込みのモデルかを確かめてください'
      );
      // 止まった後は、もう一度同期できる
      await expect(item.getByRole('button', { name: '同期' })).toBeEnabled();
    });
  });
});
