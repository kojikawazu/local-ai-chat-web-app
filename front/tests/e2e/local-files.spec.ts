import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import path from 'path';
import { E2E_LOCAL_FILES_DIR } from './helpers/local-files';
import { IS_LIGHT_MODEL } from './helpers/model';
import {
  cleanupAllConversations,
  createConversation,
  createMessage,
  sendMessage,
  waitForResponseComplete,
} from './helpers/test-data';

/**
 * ローカルのファイルのツール（#148 Phase A）の E2E。
 *
 * dev サーバーには `playwright.config.ts` が `LOCAL_FILE_ROOTS` として E2E 用のフォルダ（`fixtures/local-files/`）を渡す。
 * ツールの一覧と、保存済みの結果の表示（見出しのラベル・要約・止めた理由）は軽量モデル・CI でも確かめる。
 * 実際にモデルにファイルを読ませるテストはツール呼び出しが要るため、軽量モデルではスキップする。
 * パスの判定・秘匿ファイル・持ち出しの抑止の契約は UT（local-files.test.ts）・IT（local-files.test.ts・
 * chat-agent-local-files.test.ts）が担う。
 */

const README = path.join(E2E_LOCAL_FILES_DIR, 'README.md');

/**
 * ツール呼び出しを持つ応答を保存し、その会話を開く。
 *
 * @param page - 会話を開くページ
 * @param request - 会話・メッセージを作る API クライアント
 * @param title - 会話のタイトル
 * @param toolCalls - 保存するツール呼び出し
 */
async function openWithToolCalls(
  page: Page,
  request: APIRequestContext,
  title: string,
  toolCalls: Record<string, unknown>[]
) {
  const conv = await createConversation(request, title);
  await createMessage(request, conv.id, 'user', 'README を読んで');
  await createMessage(request, conv.id, 'assistant', '読んだ結果です', {
    toolCalls,
    agentRounds: 2,
  });
  await page.goto('/');
  await page.getByText(title).click();
  await expect(page.getByText('読んだ結果です')).toBeVisible();
}

test.describe('ローカルのファイルのツール', () => {
  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('LOCAL_FILE_ROOTS を渡した dev サーバーでは、3 つのツールが一覧に出る', async ({
      request,
    }) => {
      const res = await request.get('/api/tools');
      const names = (await res.json()).tools.map(
        (tool: { name: string }) => tool.name
      );
      // 再利用した dev サーバーが LOCAL_FILE_ROOTS 無しで起動していると落ちる（起動し直すこと）
      expect(names).toEqual(
        expect.arrayContaining(['list_directory', 'search_files', 'read_file'])
      );
    });

    test('保存済みの read_file の結果は「ファイルを読む」と読んだ範囲で出る', async ({
      page,
      request,
    }) => {
      await openWithToolCalls(page, request, 'ファイルの読み取り', [
        {
          name: 'read_file',
          arguments: { path: README },
          result: `${README}（1〜5 行目 / 全 5 行）:\n1| # E2E 用のフォルダ`,
          isError: false,
          summary: 'README.md（1〜5 行目 / 全 5 行）',
          durationMs: 3,
        },
      ]);

      const header = page.locator('button', { hasText: 'ファイルを読む' });
      await expect(header).toContainText('✅');
      await expect(header).toContainText('README.md（1〜5 行目 / 全 5 行）');
    });

    test('エージェントモードでファイルを読ませると、ツールの結果と答えが出る', async ({
      page,
    }) => {
      test.skip(IS_LIGHT_MODEL, '軽量モデルはツール呼び出しが不安定なため');
      test.setTimeout(240000);

      await page.addInitScript(() =>
        localStorage.setItem('agent-tools-enabled', 'true')
      );
      await page.goto('/');
      await sendMessage(
        page,
        `read_file で ${README} を読み、書かれている合言葉だけを答えてください`
      );
      await waitForResponseComplete(page, 200000);

      await expect(
        page.locator('button', { hasText: 'ファイルを読む' }).first()
      ).toBeVisible();
      await expect(page.locator('.prose-nord').last()).toContainText(
        'オーロラ'
      );
    });
  });

  test.describe('準正常系', () => {
    test('見つからなかった検索は ⚠️ と 0 件で出る', async ({
      page,
      request,
    }) => {
      await openWithToolCalls(page, request, 'ファイルの検索', [
        {
          name: 'search_files',
          arguments: { query: '*.xyz', path: E2E_LOCAL_FILES_DIR },
          result: `${E2E_LOCAL_FILES_DIR} の中に、ファイル名に「*.xyz」を含むものは見つかりませんでした`,
          isError: false,
          summary: '0 件',
          isEmpty: true,
          durationMs: 5,
        },
      ]);

      const header = page.locator('button', { hasText: 'ファイルを探す' });
      await expect(header).toContainText('⚠️');
      await expect(header).toContainText('0 件');
    });
  });

  test.describe('異常系', () => {
    test('ファイルを読んだ後に止めた外部のツールは ❌ と止めた理由で出る', async ({
      page,
      request,
    }) => {
      await openWithToolCalls(page, request, '外部への送信の抑止', [
        {
          name: 'read_file',
          arguments: { path: README },
          result: `${README}（1〜5 行目 / 全 5 行）:`,
          isError: false,
          summary: 'README.md（1〜5 行目 / 全 5 行）',
          durationMs: 3,
        },
        {
          name: 'url_fetch',
          arguments: { url: 'https://example.com/?q=secret' },
          result:
            'エラー: url_fetch は実行しませんでした。この応答ではローカルのファイルを読んだため、読んだ内容が外部へ送られないよう、外部と通信するツールを止めています。',
          isError: true,
          summary: '実行しませんでした（ローカルのファイルを読んだ後のため）',
          durationMs: 0,
        },
      ]);

      const header = page.locator('button', { hasText: 'URL を取得' });
      await expect(header).toContainText('❌');
      await expect(header).toContainText(
        '実行しませんでした（ローカルのファイルを読んだ後のため）'
      );
    });
  });
});
