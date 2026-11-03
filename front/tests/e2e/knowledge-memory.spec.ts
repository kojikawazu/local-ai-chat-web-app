import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import path from 'path';
import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import {
  E2E_MEMORY_DIR,
  E2E_MEMORY_VAULT_NAME,
} from './helpers/knowledge-vault';
import { IS_LIGHT_MODEL } from './helpers/model';
import {
  cleanupAllConversations,
  sendMessage,
  waitForResponseComplete,
} from './helpers/test-data';

/**
 * 会話から覚えさせたことをメモの保管庫に書く `save_memory`（#236。`docs/28-rag.md`「会話から覚えさせる（Phase D）」）の E2E。
 *
 * dev サーバーには `playwright.config.ts` が、OS の一時フォルダの E2E 用のフォルダ（{@link E2E_MEMORY_DIR}。git でない）を
 * `KNOWLEDGE_VAULTS` と `KNOWLEDGE_MEMORY_VAULT` に渡す。ツールの登録・メモの保管庫の表示・書いたメモが次の会話の出典に
 * 出ることは軽量モデルでも確かめる（出典は CI では応答の完了を待てないためスキップ）。モデルに覚えさせて承認カードを
 * 操作するテストはツール呼び出しが要るため、軽量モデルではスキップする。
 * main へのコミット・承認の間の変更・コミットの失敗などは IT（knowledge-memory.test.ts）が担う。
 *
 * 後片付けは、メモを消してから同期して、開発の DB の索引を空にする（アプリの API だけで戻す）。
 */

const VAULTS_API = '/api/knowledge/vaults';

/** モデルに覚えさせるメモの名前（E2E のものと分かる名前） */
const MEMORY_NAME = 'e2e-memory-coffee';

/** モデルに覚えさせるメモのファイル */
const MEMORY_FILE = path.join(E2E_MEMORY_DIR, 'memories', `${MEMORY_NAME}.md`);

/**
 * メモの保管庫の索引を、今のフォルダの中身にそろえる（API で差分を求め、全部同期する）。
 *
 * @param request - Playwright の API クライアント
 */
async function syncMemoryVault(request: APIRequestContext) {
  const planRes = await request.post(
    `${VAULTS_API}/${E2E_MEMORY_VAULT_NAME}/plan`
  );
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
    await request.post(`${VAULTS_API}/${E2E_MEMORY_VAULT_NAME}/sync`, {
      data: { path: target },
    });
  }
}

/**
 * メモの保管庫を空にする（前のテストのメモを消す）。
 */
async function clearMemories() {
  await rm(path.join(E2E_MEMORY_DIR, 'memories'), {
    recursive: true,
    force: true,
  });
}

/**
 * エージェントモードで、メモを覚えさせる。
 *
 * @param page - 対象のページ
 * @param content - 覚えさせる内容
 */
async function askToRemember(page: Page, content: string) {
  await page.addInitScript(() =>
    localStorage.setItem('agent-tools-enabled', 'true')
  );
  await page.goto('/');
  await sendMessage(
    page,
    `save_memory で、name を ${MEMORY_NAME}、type を preference にして「${content}」を覚えておいて`
  );
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

test.describe('会話から覚えさせる（メモの保管庫）', () => {
  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
    await clearMemories();
  });

  test.afterAll(async ({ request }) => {
    // メモを消して同期し、開発の DB の索引を空にする
    await clearMemories();
    await syncMemoryVault(request);
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('メモを書くツールが一覧に出る', async ({ request }) => {
      const res = await request.get('/api/tools');
      const names = (await res.json()).tools.map(
        (tool: { name: string }) => tool.name
      );
      expect(names).toContain('save_memory');
    });

    test('メモの保管庫に書いたメモは、同期の後の会話で出典に出る', async ({
      page,
      request,
    }) => {
      test.skip(
        !!process.env.CI,
        'CI環境(CPU only)ではストリーミング完了まで時間がかかりすぎるためスキップ'
      );
      // save_memory が書く形のメモを置く（書き込みとコミットは IT で確かめる）
      await mkdir(path.dirname(MEMORY_FILE), { recursive: true });
      await writeFile(
        MEMORY_FILE,
        [
          '---',
          `name: ${MEMORY_NAME}`,
          'description: "オーロラ計画の合言葉"',
          'type: fact',
          'created: 2026-11-03',
          'updated: 2026-11-03',
          '---',
          '',
          'オーロラ計画の合言葉は「緑色のトナカイ」である。',
          '',
        ].join('\n')
      );
      await syncMemoryVault(request);

      await page.goto('/');
      await page
        .locator('form')
        .getByRole('button', { name: 'ドキュメントを参照', exact: true })
        .click();
      await sendMessage(page, 'オーロラ計画の合言葉は？');
      await waitForResponseComplete(page);

      await page
        .getByRole('main')
        .getByRole('button', { name: /^参照したドキュメント/ })
        .click();
      await expect(
        page.getByRole('list', { name: '参照したドキュメント' })
      ).toContainText(`${E2E_MEMORY_VAULT_NAME}/memories/${MEMORY_NAME}.md`);
    });

    test('覚えてと頼むと、承認カードに置き場所と中身を出し、許可するとメモを書く', async ({
      page,
    }) => {
      test.skip(IS_LIGHT_MODEL, '軽量モデルはツール呼び出しが不安定なため');
      // 大きいモデルの読み込み・考える時間を含めて待つ（ほかの承認の E2E と同じ）
      test.setTimeout(240000);
      await askToRemember(page, 'コーヒーはブラックで飲む');

      const card = approvalCard(page);
      await expect(card).toBeVisible({ timeout: 200000 });
      await expect(
        card.getByRole('heading', { name: 'メモを保存します' })
      ).toBeVisible();
      await expect(card).toContainText(
        `${E2E_MEMORY_VAULT_NAME}/memories/${MEMORY_NAME}.md`
      );
      await expect(card).toContainText('git ではないためコミットしません');
      await expect(card.getByLabel('変更の差分')).toContainText(
        `+name: ${MEMORY_NAME}`
      );

      await card.getByRole('button', { name: '許可' }).click();
      await waitForResponseComplete(page);

      expect(await readFile(MEMORY_FILE, 'utf8')).toContain(
        `name: ${MEMORY_NAME}`
      );
    });
  });

  test.describe('準正常系', () => {
    test('ドキュメントのダイアログに、メモの保管庫を保管庫の 1 つとして出す', async ({
      page,
    }) => {
      await page.goto('/');
      await page
        .locator('aside')
        .getByRole('button', { name: 'ドキュメントを開く' })
        .click();
      const item = page
        .getByRole('dialog', { name: 'ドキュメント' })
        .getByRole('listitem', { name: `保管庫 ${E2E_MEMORY_VAULT_NAME}` });

      await expect(item).toBeVisible();
      await expect(item).toContainText('フォルダ');
    });

    test('承認カードで拒否すると、メモを書かない', async ({ page }) => {
      test.skip(IS_LIGHT_MODEL, '軽量モデルはツール呼び出しが不安定なため');
      // 大きいモデルの読み込み・考える時間を含めて待つ（ほかの承認の E2E と同じ）
      test.setTimeout(240000);
      await askToRemember(page, 'お茶は緑茶が好き');

      const card = approvalCard(page);
      await expect(card).toBeVisible({ timeout: 200000 });
      await card.getByRole('button', { name: '拒否' }).click();
      await waitForResponseComplete(page);

      await expect(readFile(MEMORY_FILE, 'utf8')).rejects.toThrow();
    });
  });

  test.describe('異常系', () => {
    test('鍵らしい文字列を覚えさせようとしても、承認を求めずに書かない', async ({
      page,
    }) => {
      test.skip(IS_LIGHT_MODEL, '軽量モデルはツール呼び出しが不安定なため');
      // 大きいモデルの読み込み・考える時間を含めて待つ（ほかの承認の E2E と同じ）
      test.setTimeout(240000);
      await askToRemember(page, 'API キーは AKIAABCDEFGHIJKLMNOP');
      await waitForResponseComplete(page);

      await expect(approvalCard(page)).toHaveCount(0);
      await expect(readFile(MEMORY_FILE, 'utf8')).rejects.toThrow();
    });
  });
});
