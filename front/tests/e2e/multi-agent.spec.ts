import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { IS_LIGHT_MODEL } from './helpers/model';
import {
  cleanupAllConversations,
  createConversation,
  createMessage,
  sendMessage,
  waitForResponseComplete,
} from './helpers/test-data';

/**
 * サブエージェントに任せる（#26。`docs/29-multi-agent.md`）の E2E。
 *
 * 設定の切り替え・送る値・保存した委譲の記録の表示は、軽量モデルでも確かめる（記録は API で会話を作って入れ、
 * 送る値は `/api/chat` を通信の境界で受ける）。実際のモデルに任せるテストはツール呼び出しが要るため、軽量モデルではスキップする。
 * 委譲の配線（渡すもの・返すもの・止める規則・上限）は IT（chat-agent-sub-agent.test.ts）が担う。
 *
 * 開発の DB を使う。取り込むドキュメントは名前を {@link PREFIX} で始め、それだけを消す（`knowledge-chat.spec.ts` と同じ）。
 */

const DOCUMENTS_API = '/api/knowledge/documents';

/** テストで作るドキュメントの名前の頭（`knowledge.spec.ts`・`knowledge-chat.spec.ts` と同じ） */
const PREFIX = 'e2e-knowledge-';

/** 手元の読み手に探させるドキュメント（ほかのドキュメントに無い作り話にする） */
const DOCUMENT = {
  name: `${PREFIX}subagent-aurora.md`,
  content:
    '# 北極光プロジェクト\n\n## 合言葉\n\n北極光プロジェクトの合言葉は「銀色のホッキョクギツネ」である。\n',
};

/** 保存しておく、成功した委譲の記録 */
const DELEGATION = {
  name: 'delegate_to_agent',
  arguments: { agent: 'researcher', task: 'Next.js 16 の新機能を調べて' },
  result: 'Next.js 16 の要点（出典 https://example.com/next16）',
  isError: false,
  summary: 'ツール 2 回',
  durationMs: 1200,
  contentOffset: 0,
  subAgent: {
    agent: 'researcher',
    task: 'Next.js 16 の新機能を調べて',
    rounds: 3,
    toolCalls: [
      {
        name: 'web_search',
        arguments: { query: 'Next.js 16 新機能' },
        result: '"Next.js 16 新機能" の検索結果 (上位1件)',
        isError: false,
        summary: '1 件',
        durationMs: 300,
      },
      {
        name: 'url_fetch',
        arguments: { url: 'https://example.com/next16' },
        result: 'Next.js 16 のページの本文',
        isError: false,
        durationMs: 400,
      },
    ],
  },
};

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
 * エージェントモード（と、指定すればサブエージェントに任せる設定）を保存した状態でページを開く。
 *
 * @param page - 対象のページ
 * @param options - `tools` はエージェントモード、`subAgents` はサブエージェントに任せるか
 */
async function openWithSettings(
  page: Page,
  options: { tools: boolean; subAgents: boolean }
) {
  await page.addInitScript((settings) => {
    // 初めて開くときだけ入れる（init script はリロードのたびに走るため、画面で変えた値を上書きしない）
    if (localStorage.getItem('agent-tools-enabled') !== null) return;
    localStorage.setItem('agent-tools-enabled', String(settings.tools));
    localStorage.setItem(
      'agent-sub-agents-enabled',
      String(settings.subAgents)
    );
  }, options);
  await page.goto('/');
}

/**
 * 設定のモーダルを開く。
 *
 * @param page - 対象のページ
 * @returns 設定のダイアログ
 */
async function openSettings(page: Page) {
  await page.locator('button[aria-label="設定を開く"]').click();
  const dialog = page.getByRole('dialog', { name: '設定' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * 委譲の記録を持つ応答を保存した会話を開く。
 *
 * @param page - 対象のページ
 * @param request - API を呼ぶコンテキスト
 * @param title - 会話のタイトル
 * @param toolCall - 委譲のツールの記録
 */
async function openSavedDelegation(
  page: Page,
  request: APIRequestContext,
  title: string,
  toolCall: Record<string, unknown>
) {
  const conv = await createConversation(request, title);
  await createMessage(request, conv.id, 'user', '調べて');
  await createMessage(request, conv.id, 'assistant', 'まとめました。', {
    toolCalls: [toolCall],
  });
  await page.goto('/');
  await page.getByText(title).click();
  await expect(page.getByText('まとめました。')).toBeVisible();
}

/**
 * 入力欄の横の「サブエージェントに任せる」の切り替え（#26）。
 *
 * @param page - 対象のページ
 * @returns 切り替えのボタン
 */
function chatBarToggle(page: Page) {
  return page
    .locator('form')
    .getByRole('button', { name: 'サブエージェントに任せる', exact: true });
}

/**
 * `/api/chat` を通信の境界で受け、送られたボディを記録して短い応答を返す。
 *
 * @param page - 対象のページ
 * @returns 送られたボディ（送られた順）
 */
async function captureChatRequests(page: Page) {
  const sent: Record<string, unknown>[] = [];
  await page.route('**/api/chat', async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body:
        [
          JSON.stringify({ type: 'text_delta', content: '了解です。' }),
          JSON.stringify({ type: 'done', metadata: { toolCalls: [] } }),
        ].join('\n') + '\n',
    });
  });
  return sent;
}

test.describe('サブエージェントに任せる', () => {
  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
    await deleteTestDocuments(request);
  });

  test.describe('正常系', () => {
    test('設定で「サブエージェントに任せる」を入れると保存し、送信で enableSubAgents を送る', async ({
      page,
    }) => {
      await openWithSettings(page, { tools: true, subAgents: false });
      const dialog = await openSettings(page);
      const toggle = dialog.getByRole('button', {
        name: /サブエージェントに任せる/,
      });
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');

      // 開き直しても残る
      await page.reload();
      await expect(
        (await openSettings(page)).getByRole('button', {
          name: /サブエージェントに任せる/,
        })
      ).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: 'Close' }).click();

      const sent = await captureChatRequests(page);
      await sendMessage(page, '調べて');
      await expect(page.getByText('了解です。')).toBeVisible();
      expect(sent).toEqual([
        expect.objectContaining({ enableTools: true, enableSubAgents: true }),
      ]);
    });

    test('入力欄の横の切り替えは設定と同じ値を持ち、そこで入れても送信で enableSubAgents を送る', async ({
      page,
    }) => {
      await openWithSettings(page, { tools: true, subAgents: false });
      const toggle = chatBarToggle(page);
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      // 設定のモーダルの切り替えも同じ値になる
      await expect(
        (await openSettings(page)).getByRole('button', {
          name: /サブエージェントに任せる/,
        })
      ).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: 'Close' }).click();

      const sent = await captureChatRequests(page);
      await sendMessage(page, '調べて');
      await expect(page.getByText('了解です。')).toBeVisible();
      expect(sent).toEqual([
        expect.objectContaining({ enableTools: true, enableSubAgents: true }),
      ]);
    });

    test('保存した委譲の記録を開くと、任せた相手・任せた仕事・中の手順・回答を出す', async ({
      page,
      request,
    }) => {
      await openSavedDelegation(page, request, '委譲の記録', DELEGATION);

      const header = page
        .getByRole('main')
        .getByRole('button', { name: /サブエージェント: Web の調べもの/ });
      await expect(header).toContainText('ツール 2 回');
      // 委譲は数分かかるため、所要時間は秒で出す
      await expect(header).toContainText('(1 秒)');
      await header.click();

      const main = page.getByRole('main');
      await expect(main.getByText('任せた仕事')).toBeVisible();
      await expect(
        main.getByText('Next.js 16 の新機能を調べて').first()
      ).toBeVisible();
      const steps = main.getByRole('list', { name: 'サブエージェントの手順' });
      await expect(steps.getByRole('listitem')).toHaveCount(2);
      await expect(steps.getByRole('listitem').first()).toContainText(
        'Web 検索'
      );
      await expect(steps.getByRole('listitem').first()).toContainText(
        'Next.js 16 新機能'
      );
      await expect(steps.getByRole('listitem').nth(1)).toContainText(
        'URL を取得'
      );
      await expect(main.getByText('回答', { exact: true })).toBeVisible();
      await expect(
        main.getByText('Next.js 16 の要点（出典 https://example.com/next16）')
      ).toBeVisible();

      // 手順を開くと、そのツールの結果を出す
      await steps.getByText('URL を取得').click();
      await expect(steps.getByText('Next.js 16 のページの本文')).toBeVisible();
    });

    test('大きいモデルに手元の読み手へ任せさせると、ドキュメントを探した手順が出る', async ({
      page,
      request,
    }) => {
      test.skip(IS_LIGHT_MODEL, '軽量モデルはツール呼び出しが不安定なため');
      // 大きいモデルの読み込み・メインとサブエージェントの問い合わせを含めて待つ
      test.setTimeout(420000);
      await deleteTestDocuments(request);
      const imported = await request.post(DOCUMENTS_API, {
        multipart: {
          file: {
            name: DOCUMENT.name,
            mimeType: 'text/markdown',
            buffer: Buffer.from(DOCUMENT.content),
          },
        },
      });
      expect(imported.status()).toBe(201);

      await openWithSettings(page, { tools: true, subAgents: true });
      await sendMessage(
        page,
        'delegate_to_agent で reader に任せて、登録したドキュメントから北極光プロジェクトの合言葉を探して'
      );
      // 任せている間は、任せた相手と経過時間を出す（ふつうのツールの「実行中...」と見分けられる）
      await expect(
        page
          .getByRole('status')
          .filter({ hasText: 'サブエージェントが手元を読んでいます' })
      ).toBeVisible({ timeout: 300000 });
      await waitForResponseComplete(page, 400000);

      const header = page
        .getByRole('main')
        .getByRole('button', { name: /サブエージェント: 手元の読みもの/ })
        .first();
      await expect(header).toBeVisible();
      await header.click();
      await expect(
        page
          .getByRole('main')
          .getByRole('list', { name: 'サブエージェントの手順' })
          .first()
      ).toContainText('ドキュメントを探す');
    });
  });

  test.describe('準正常系', () => {
    test('エージェントモードがオフなら（設定・入力欄の横とも）切り替えを出さず、任せる設定が残っていても送らない', async ({
      page,
    }) => {
      await openWithSettings(page, { tools: false, subAgents: true });
      const dialog = await openSettings(page);
      await expect(
        dialog.getByRole('button', { name: /サブエージェントに任せる/ })
      ).toHaveCount(0);
      await page.getByRole('button', { name: 'Close' }).click();
      await expect(chatBarToggle(page)).toHaveCount(0);

      const sent = await captureChatRequests(page);
      await sendMessage(page, 'こんにちは');
      await expect(page.getByText('了解です。')).toBeVisible();
      expect(sent).toEqual([
        expect.objectContaining({ enableTools: false, enableSubAgents: false }),
      ]);
    });
  });

  test.describe('異常系', () => {
    test('失敗した委譲の記録（中の手順の失敗を含む）を開いても崩れない', async ({
      page,
      request,
    }) => {
      await openSavedDelegation(page, request, '失敗した委譲', {
        ...DELEGATION,
        result:
          'エラー: サブエージェントが応答できませんでした（Ollama API error: 404）',
        isError: true,
        summary:
          'サブエージェントが応答できませんでした（Ollama API error: 404）',
        subAgent: {
          ...DELEGATION.subAgent,
          rounds: 2,
          toolCalls: [
            {
              name: 'web_search',
              arguments: { query: 'Next.js 16 新機能' },
              result: 'エラー: SearXNG に接続できません',
              isError: true,
              summary: 'SearXNG に接続できません',
              durationMs: 10,
            },
          ],
        },
      });

      const header = page
        .getByRole('main')
        .getByRole('button', { name: /サブエージェント: Web の調べもの/ });
      await expect(header).toContainText('❌');
      await header.click();

      const steps = page
        .getByRole('main')
        .getByRole('list', { name: 'サブエージェントの手順' });
      await expect(steps.getByRole('listitem')).toHaveCount(1);
      await expect(steps).toContainText('❌');
      await expect(steps).toContainText('SearXNG に接続できません');
      await expect(
        page
          .getByRole('main')
          .getByText(/Ollama API error: 404/)
          .first()
      ).toBeVisible();
    });
  });
});
