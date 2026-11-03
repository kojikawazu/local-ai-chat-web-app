import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import {
  cleanupAllConversations,
  createConversation,
  createMessage,
  fetchConversations,
  fetchMessages,
  sendMessage,
  waitForResponseComplete,
} from './helpers/test-data';

/**
 * 会話でのドキュメントの参照と出典の E2E（#17 Phase B。`docs/28-rag.md`「会話での参照」）。
 *
 * 入力欄の「ドキュメントを参照」の切り替え（会話ごとの保存・ドキュメントが無いとき）と、応答の下の出典の表示を確かめる。
 * 実際に探して答えることは、生成の完了を待つため CI ではスキップする（`chat-streaming.spec.ts` と同じ）。出典の表示は
 * API で保存した会話を開いて確かめる（軽量モデル・CI でも動く）。探し方（近い順・しきい値・モデル）・システムプロンプト・
 * エージェントモードの止め方は IT（chat-knowledge.test.ts）、出典の形は UT が担う。
 * 失敗は `page.route` で通信の境界に注入する。
 *
 * 開発の DB を使う。取り込むドキュメントは名前を {@link PREFIX} で始め、それだけを消す（利用者のドキュメントには触らない。
 * `knowledge.spec.ts` と同じ）。
 */

const DOCUMENTS_API = '/api/knowledge/documents';

/** テストで作るドキュメントの名前の頭（`knowledge.spec.ts` と同じ） */
const PREFIX = 'e2e-knowledge-';

/** 実際に探す E2E で取り込むドキュメント（ほかのドキュメントに無い作り話にして、質問がこれに近くなるようにする） */
const DOCUMENT = {
  name: `${PREFIX}frostberry.md`,
  content:
    '# フロストベリー計画\n\n## 合言葉\n\nフロストベリー計画の合言葉は「青い氷河のフクロウ」である。\n',
};

/** 保存しておく出典（抜き出しに Markdown の記号を入れ、文字のまま出ることも見る） */
const SOURCES = [
  {
    documentName: '設計書.md',
    heading: '範囲 > 含める',
    excerpt: '会話ごとに **切り替える**。',
    similarity: 0.62,
  },
  {
    documentName: 'メモ.txt',
    heading: '',
    excerpt: 'メモの本文',
    similarity: 0.41,
  },
];

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
 * 入力欄の「ドキュメントを参照」の切り替え。
 *
 * @param page - 対象のページ
 * @returns 切り替えのボタン
 */
function knowledgeToggle(page: Page) {
  return page
    .locator('form')
    .getByRole('button', { name: 'ドキュメントを参照', exact: true });
}

/**
 * 出典の要約のボタン。
 *
 * @param page - 対象のページ
 * @returns 要約のボタン
 */
function sourcesSummary(page: Page) {
  return page
    .getByRole('main')
    .getByRole('button', { name: /^参照したドキュメント/ });
}

/**
 * 応答の metadata を指定して会話を保存し、開く。
 *
 * @param page - 対象のページ
 * @param request - API を呼ぶコンテキスト
 * @param title - 会話のタイトル
 * @param metadata - 応答の metadata
 */
async function openSavedAnswer(
  page: Page,
  request: APIRequestContext,
  title: string,
  metadata: Record<string, unknown>
) {
  const conv = await createConversation(request, title);
  await createMessage(request, conv.id, 'user', '範囲は？');
  await createMessage(
    request,
    conv.id,
    'assistant',
    '会話ごとです。',
    metadata
  );
  await page.goto('/');
  await page.getByText(title).click();
  await expect(page.getByText('会話ごとです。')).toBeVisible();
}

test.describe('会話でのドキュメントの参照', () => {
  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
    await deleteTestDocuments(request);
  });

  test.describe('正常系', () => {
    test('切り替えを入れて送ると、取り込んだドキュメントを出典に出し、再読み込みの後も残る', async ({
      page,
      request,
    }) => {
      test.skip(
        !!process.env.CI,
        'CI環境(CPU only)ではストリーミング完了まで時間がかかりすぎるためスキップ'
      );
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

      await page.goto('/');
      const toggle = knowledgeToggle(page);
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      // 会話を作る前に入れる（最初の送信で会話と同時に保存する）
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');

      await sendMessage(page, 'フロストベリー計画の合言葉は何ですか？');
      await waitForResponseComplete(page);

      // 中身は答えではなく出典で確かめる（小さいモデルの答えは揺れる）
      await sourcesSummary(page).click();
      const list = page.getByRole('list', { name: '参照したドキュメント' });
      await expect(list).toContainText(DOCUMENT.name);
      await expect(list).toContainText('青い氷河のフクロウ');

      const [conversation] = await fetchConversations(request);
      expect(conversation).toMatchObject({ knowledgeEnabled: true });
      const messages = await fetchMessages(request, conversation.id);
      const sources = messages[1].metadata?.knowledgeSources as {
        documentName: string;
      }[];
      expect(sources.map((s) => s.documentName)).toContain(DOCUMENT.name);

      await page.reload();
      // タイトルは応答の後に裏で生成されて変わるため、タイトルでなく一覧の先頭（この会話だけ）を開く（agent-metadata.spec.ts と同じ）
      await page.locator('nav button').first().click();
      await expect(sourcesSummary(page)).toBeVisible();
      await expect(knowledgeToggle(page)).toHaveAttribute(
        'aria-pressed',
        'true'
      );
    });

    test('保存した出典を件数で要約し、押すと名前・見出し・抜き出し・類似度を文字のまま出す', async ({
      page,
      request,
    }) => {
      await openSavedAnswer(page, request, '出典の会話', {
        knowledgeSources: SOURCES,
      });

      const summary = sourcesSummary(page);
      await expect(summary).toHaveText('参照したドキュメント（2）');
      await expect(summary).toHaveAttribute('aria-expanded', 'false');

      await summary.click();
      await expect(summary).toHaveAttribute('aria-expanded', 'true');
      const items = page
        .getByRole('list', { name: '参照したドキュメント' })
        .getByRole('listitem');
      await expect(items).toHaveCount(2);
      await expect(items.nth(0)).toContainText('設計書.md');
      await expect(items.nth(0)).toContainText('範囲 > 含める');
      await expect(items.nth(0)).toContainText('類似度 0.62');
      // Markdown として描かない（** がそのまま出て、太字の要素にならない）
      await expect(items.nth(0)).toContainText('会話ごとに **切り替える**。');
      await expect(items.nth(0).locator('strong')).toHaveCount(0);
      await expect(items.nth(1)).toContainText('メモ.txt');
      await expect(items.nth(1)).toContainText('類似度 0.41');

      await summary.click();
      await expect(
        page.getByRole('list', { name: '参照したドキュメント' })
      ).toBeHidden();
    });

    test('開いている会話で切り替えると保存し、再読み込みの後も残る', async ({
      page,
      request,
    }) => {
      const conv = await createConversation(request, '切り替えの会話');
      // 開発の DB のドキュメントの有無に左右されないよう、一覧を 1 件にする（入れられる状態）
      await page.route(`**${DOCUMENTS_API}`, (route) =>
        route.fulfill({ json: { documents: [{ id: 'x', name: 'a.md' }] } })
      );
      await page.goto('/');
      await page.getByText('切り替えの会話').click();

      const toggle = knowledgeToggle(page);
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      await expect
        .poll(
          async () =>
            (await fetchConversations(request)).find((c) => c.id === conv.id)
              ?.knowledgeEnabled
        )
        .toBe(true);

      await page.reload();
      await page.getByText('切り替えの会話').click();
      await expect(knowledgeToggle(page)).toHaveAttribute(
        'aria-pressed',
        'true'
      );

      await knowledgeToggle(page).click();
      await expect(knowledgeToggle(page)).toHaveAttribute(
        'aria-pressed',
        'false'
      );
    });
  });

  test.describe('準正常系', () => {
    test('探したが見つからなかった応答は、そのことを出す', async ({
      page,
      request,
    }) => {
      await openSavedAnswer(page, request, '見つからない会話', {
        knowledgeSources: [],
      });

      await expect(
        page.getByText('参照できるドキュメントが見つかりませんでした')
      ).toBeVisible();
      await expect(sourcesSummary(page)).toHaveCount(0);
    });

    test('ドキュメントが 1 つも無いと入れられず、理由を出す', async ({
      page,
    }) => {
      await page.route(`**${DOCUMENTS_API}`, (route) =>
        route.fulfill({ json: { documents: [], embeddingModel: 'x' } })
      );
      await page.goto('/');

      const toggle = knowledgeToggle(page);
      await expect(toggle).toHaveAttribute('aria-disabled', 'true');
      // 理由は名前に混ぜず、説明（title）で伝える（名前で探すほかのボタンと取り違えないため）
      await expect(toggle).toHaveAccessibleName('ドキュメントを参照');
      await expect(toggle).toHaveAccessibleDescription(
        'ドキュメントを参照（ドキュメントがありません。サイドバーの「ドキュメント」から取り込んでください）'
      );
      // aria-disabled のボタンは Playwright が押せないものとして待つため、押せないことを確かめるために force で押す
      await toggle.click({ force: true });
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    });

    test('ドキュメントを参照しなかった応答には出典を出さない', async ({
      page,
      request,
    }) => {
      await openSavedAnswer(page, request, '参照しない会話', {});

      await expect(sourcesSummary(page)).toHaveCount(0);
      await expect(
        page.getByText('参照できるドキュメントが見つかりませんでした')
      ).toHaveCount(0);
    });
  });

  test.describe('異常系', () => {
    test('切り替えの保存に失敗したら理由を出し、切り替えは変えない', async ({
      page,
      request,
    }) => {
      await createConversation(request, '保存に失敗する会話');
      // 開発の DB のドキュメントの有無に左右されないよう、一覧を 1 件にする（入れられる状態）
      await page.route(`**${DOCUMENTS_API}`, (route) =>
        route.fulfill({ json: { documents: [{ id: 'x', name: 'a.md' }] } })
      );
      await page.route('**/api/conversations/*', async (route) => {
        if (route.request().method() !== 'PATCH') return route.fallback();
        await route.fulfill({
          status: 500,
          json: { error: '会話の更新に失敗しました' },
        });
      });
      await page.goto('/');
      await page.getByText('保存に失敗する会話').click();

      await knowledgeToggle(page).click();

      await expect(page.getByText('会話の更新に失敗しました')).toBeVisible();
      await expect(knowledgeToggle(page)).toHaveAttribute(
        'aria-pressed',
        'false'
      );
    });

    test('探すのに失敗したら（埋め込みのモデルが無い）理由を出し、応答を残さない', async ({
      page,
    }) => {
      const sent: unknown[] = [];
      await page.route('**/api/chat', async (route) => {
        sent.push(route.request().postDataJSON());
        await route.fulfill({
          status: 502,
          json: {
            error:
              '埋め込みのモデル（embeddinggemma:300m）がありません。ollama pull embeddinggemma:300m を実行してください',
          },
        });
      });
      await page.route(`**${DOCUMENTS_API}`, (route) =>
        route.fulfill({ json: { documents: [{ id: 'x', name: 'a.md' }] } })
      );
      await page.goto('/');
      await knowledgeToggle(page).click();

      await sendMessage(page, '範囲は？');

      await expect(
        page.getByText('ollama pull embeddinggemma:300m を実行してください')
      ).toBeVisible();
      // 切り替えの値を送っている
      expect(sent).toEqual([
        expect.objectContaining({
          message: '範囲は？',
          knowledgeEnabled: true,
        }),
      ]);
      await expect(sourcesSummary(page)).toHaveCount(0);
    });
  });
});
