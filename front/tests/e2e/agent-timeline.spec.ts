import { test, expect } from '@playwright/test';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import {
  cleanupAllConversations,
  createConversation,
  createMessage,
} from './helpers/test-data';

/**
 * エージェントの応答を時系列（説明 → ツールの結果 → 回答）で並べる表示の E2E（#186）。
 *
 * 表示は保存済みの metadata（ツール呼び出しの `contentOffset`）から復元する経路と、生成中の経路が同じ関数
 * （`buildAgentTimeline`）を使うため、API で応答を用意して検証する（モデルに依存せず、軽量モデル・CI でも動く）。
 * 位置の数え方・区切りの空行の契約は IT（chat-agent.test.ts）、並べ方の細部は UT（agent-timeline.test.ts）が担う。
 */

const NARRATION = 'フォルダを確認します。';
const ANSWER = '確認した結果、README があります。';

/** 保存する read_file の呼び出し（画面で「ファイルを読む」と表示される） */
const READ_FILE = {
  name: 'read_file',
  arguments: { path: '/tmp/README.md' },
  result: '/tmp/README.md（1〜1 行目 / 全 1 行）:\n1| # README',
  isError: false,
  summary: 'README.md（1〜1 行目 / 全 1 行）',
  durationMs: 3,
};

/**
 * ツール呼び出しを持つ応答を保存し、その会話を開く。
 *
 * @param page - 会話を開くページ
 * @param request - 会話・メッセージを作る API クライアント
 * @param title - 会話のタイトル
 * @param content - 応答の本文
 * @param metadata - 応答の metadata
 */
async function openAnswer(
  page: Page,
  request: APIRequestContext,
  title: string,
  content: string,
  metadata: Record<string, unknown>
) {
  const conv = await createConversation(request, title);
  await createMessage(request, conv.id, 'user', 'README はある？');
  await createMessage(request, conv.id, 'assistant', content, metadata);
  await page.goto('/');
  await page.getByText(title).click();
  await expect(page.getByText('README はある？')).toBeVisible();
}

/**
 * 要素の画面上の上端（縦の並び順の比較に使う）。
 *
 * @param locator - 対象の要素
 * @returns 上端の y 座標
 */
async function topOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('要素が表示されていません');
  return box.y;
}

test.describe('エージェントの応答の時系列', () => {
  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('説明 → ツールの結果 → 回答の順に並び、回答が一番下に出る', async ({
      page,
      request,
    }) => {
      const content = `${NARRATION}\n\n${ANSWER}`;
      await openAnswer(page, request, '時系列の表示', content, {
        toolCalls: [{ ...READ_FILE, contentOffset: `${NARRATION}\n\n`.length }],
        agentRounds: 2,
      });

      const narration = page.getByTestId('agent-step-text');
      const tool = page.locator('button', { hasText: 'ファイルを読む' });
      const answer = page.getByText(ANSWER);
      await expect(narration).toHaveText(NARRATION);
      await expect(answer).toBeVisible();
      expect(await topOf(narration)).toBeLessThan(await topOf(tool));
      expect(await topOf(tool)).toBeLessThan(await topOf(answer));
      // 回答の吹き出しには説明を重ねて出さない
      await expect(page.getByText(NARRATION)).toHaveCount(1);
    });
  });

  test.describe('準正常系', () => {
    test('本文の位置を持たない古い応答は、従来どおり本文の吹き出し → ツールの一覧の順で出る', async ({
      page,
      request,
    }) => {
      await openAnswer(page, request, '古い応答', ANSWER, {
        toolCalls: [READ_FILE],
        agentRounds: 2,
      });

      const tool = page.locator('button', { hasText: 'ファイルを読む' });
      const answer = page.getByText(ANSWER);
      expect(await topOf(answer)).toBeLessThan(await topOf(tool));
      await expect(page.getByTestId('agent-step-text')).toHaveCount(0);
    });
  });

  test.describe('異常系', () => {
    test('ツールの後で停止して回答が無い応答は、空の吹き出しを出さず中断の表示を出す', async ({
      page,
      request,
    }) => {
      await openAnswer(page, request, '回答前の停止', NARRATION, {
        toolCalls: [{ ...READ_FILE, contentOffset: NARRATION.length }],
        agentRounds: 1,
        interrupted: true,
      });

      await expect(page.getByTestId('agent-step-text')).toHaveText(NARRATION);
      await expect(page.getByText('生成を中断しました')).toBeVisible();
      // 説明（agent-step-text の中の 1 つ）のほかに、Markdown の本文（回答の吹き出し）が無い
      await expect(page.locator('.prose-nord')).toHaveCount(1);
    });
  });
});
