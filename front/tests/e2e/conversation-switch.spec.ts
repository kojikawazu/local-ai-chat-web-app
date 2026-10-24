import type { APIRequestContext, Page, Route } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { startLongAnswer, stopButton } from './helpers/long-answer';
import {
  cleanupAllConversations,
  createConversation,
  createMessage,
  fetchConversations,
  fetchMessages,
  fillTextarea,
  sendMessage,
} from './helpers/test-data';

/**
 * 生成中に会話を切り替えたときの E2E（#147）。
 *
 * 生成中の時間は `/api/chat` の応答をテストが手放すまで止めて決定的に作る（途中までの本文が続けて届く様子だけは、
 * 実際の Ollama に長い応答を生成させて確かめる）。止めた要求はサーバーへ転送せず fulfill で返す
 * （転送すると受け手のいない生成が Ollama を占有し、後続のテストを待たせる。streaming-stop.spec.ts と同じ）。
 * 切り替える会話は API で用意する。最初のやり取りを済ませておき、送信でタイトルの自動生成が走って
 * 名前が変わらないようにする（名前で開き直すため）。
 */

/** 遅らせて返す応答の本文 */
const DELAYED_ANSWER = '遅れて届いた応答です';
/** 会話 A の保存済みの応答 */
const A_ANSWER = '会話Aの保存済みの応答です';
/** 会話 B の保存済みの応答 */
const B_ANSWER = '会話Bの保存済みの応答です';

/** 生成の途中で戻る検証で、戻る前に応答が終わったときに送り直す上限 */
const MAX_RETURN_ATTEMPTS = 3;

/** 止めておいた `/api/chat` の要求の操作と行方 */
type HeldChat = {
  /** 止めておいた応答を返させる。呼ぶまで生成中のままになる */
  release: () => void;
  /** 応答を返し終えたら true */
  fulfilled: boolean;
  /** 画面側で要求が中断されたら true（停止・会話の削除） */
  aborted: boolean;
};

/**
 * `/api/chat` の応答を、テストが `release` を呼ぶまで止めておく。
 *
 * 時間で遅らせると、否定の検証（`toBeHidden` 等）が待つ間に生成が終わって素通りするため、
 * 生成中の状態はテストが手放すまで続くようにする。
 *
 * @param page - 対象のページ
 * @param response - 手放した後に返す応答
 * @returns 要求の操作と行方。テストの進行に合わせて更新される
 */
async function holdChat(
  page: Page,
  response: Parameters<Route['fulfill']>[0]
): Promise<HeldChat> {
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const state: HeldChat = { release, fulfilled: false, aborted: false };
  page.on('requestfailed', (req) => {
    if (new URL(req.url()).pathname === '/api/chat') state.aborted = true;
  });
  await page.route('**/api/chat', async (route) => {
    await released;
    // 中断済みの要求には返せない。その場合は失敗するだけで、サーバーには何も届かない
    await route.fulfill(response).then(
      () => {
        state.fulfilled = true;
      },
      () => {}
    );
  });
  return state;
}

/**
 * 最初のやり取りを済ませた会話 A・B を用意する。
 *
 * @param request - 会話・メッセージを作る API クライアント
 * @returns 作った会話 A・B
 */
async function seedConversations(request: APIRequestContext) {
  const a = await createConversation(request, '会話A');
  await createMessage(request, a.id, 'user', '会話Aの最初の質問');
  await createMessage(request, a.id, 'assistant', A_ANSWER);
  const b = await createConversation(request, '会話B');
  await createMessage(request, b.id, 'user', '会話Bの最初の質問');
  await createMessage(request, b.id, 'assistant', B_ANSWER);
  return { a, b };
}

/**
 * チャット欄（サイドバーを除く）。送った質問はサイドバーの会話タイトルにも出るため、こちらに絞る。
 *
 * @param page - 対象のページ
 * @returns チャット欄のロケーター
 */
function main(page: Page) {
  return page.locator('main');
}

/**
 * サイドバーで会話を開く。
 *
 * @param page - 対象のページ
 * @param title - 会話のタイトル
 */
async function openConversation(page: Page, title: string) {
  await page.locator('aside').getByText(title, { exact: true }).click();
}

/**
 * サイドバーの会話に付く「生成中」の印。
 *
 * @param page - 対象のページ
 * @param title - 会話のタイトル
 * @returns 印のロケーター
 */
function generatingMark(page: Page, title: string) {
  return page
    .locator('aside div.group')
    .filter({ hasText: title })
    .getByRole('img', { name: '生成中' });
}

test.describe('生成中の会話の切り替え', () => {
  test.beforeEach(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('生成中に別の会話へ切り替えても、切り替え先で操作でき、戻ると応答が表示される', async ({
      page,
      request,
    }) => {
      const chat = await holdChat(page, {
        contentType: 'text/plain; charset=utf-8',
        body: DELAYED_ANSWER,
      });
      const { a } = await seedConversations(request);
      await page.goto('/');
      await openConversation(page, '会話A');
      await expect(main(page).getByText(A_ANSWER)).toBeVisible();
      await sendMessage(page, '会話Aの続きの質問');
      await expect(page.getByLabel('応答を生成中')).toBeVisible();

      await openConversation(page, '会話B');

      // 会話 A のやり取りは混ざらず、会話 A の生成中の状態にも引きずられない
      await expect(main(page).getByText(B_ANSWER)).toBeVisible();
      await expect(main(page).getByText('会話Aの続きの質問')).toHaveCount(0);
      await expect(page.getByLabel('応答を生成中')).toHaveCount(0);
      await expect(stopButton(page)).toBeHidden();
      await fillTextarea(page, '会話Bで入力');
      await expect(page.locator('button[type="submit"]')).toBeEnabled();

      // 生成中のうちに戻ると、送った質問と生成中の表示が残っている
      await openConversation(page, '会話A');
      await expect(main(page).getByText('会話Aの続きの質問')).toBeVisible();
      await expect(page.getByLabel('応答を生成中')).toBeVisible();

      chat.release();

      await expect(main(page).getByText(DELAYED_ANSWER)).toBeVisible();
      await expect
        .poll(async () =>
          (await fetchMessages(request, a.id)).map((m) => m.content)
        )
        .toContain(DELAYED_ANSWER);
    });

    test('生成の途中で戻ると、途中までの応答と続きが表示される', async ({
      page,
      request,
    }) => {
      // 本文が続けて届く様子は fulfill（一括で返す）では作れないため、実際の Ollama で生成させる
      test.setTimeout(180000);
      await seedConversations(request);
      await page.goto('/');
      await openConversation(page, '会話A');
      await expect(main(page).getByText(A_ANSWER)).toBeVisible();
      const answers = main(page).locator('.prose-nord');
      for (let attempt = 1; ; attempt++) {
        await startLongAnswer(page);
        // 送り直した場合は、先に短く終わった応答も含めて数える
        const answerCount = await answers.count();

        await openConversation(page, '会話B');
        await expect(main(page).getByText(B_ANSWER)).toBeVisible();
        await openConversation(page, '会話A');

        // 戻った時点で、DB にまだ無い途中までの本文が出ている
        await expect(main(page).getByText(A_ANSWER)).toBeVisible();
        await expect(answers).toHaveCount(answerCount);
        if (await stopButton(page).isVisible()) break;
        // 軽量モデルがまれに短く答え、戻る前に生成を終えた。続きを確かめられないため送り直す
        if (attempt >= MAX_RETURN_ATTEMPTS) {
          throw new Error(
            `${MAX_RETURN_ATTEMPTS} 回送っても、戻る前に応答が終わった`
          );
        }
      }
      const answer = answers.last();
      const length = (await answer.textContent())?.length ?? 0;
      await expect
        .poll(async () => (await answer.textContent())?.length ?? 0)
        .toBeGreaterThan(length);

      // 後続のテストを待たせないよう、生成を止めておく
      await stopButton(page).click();
      await expect(page.getByText('生成を中断しました')).toBeVisible();
    });
  });

  test.describe('準正常系', () => {
    test('新規会話の最初の送信中に別の会話へ移っても、作られた会話に応答が保存される', async ({
      page,
      request,
    }) => {
      const chat = await holdChat(page, {
        contentType: 'text/plain; charset=utf-8',
        body: DELAYED_ANSWER,
      });
      const { b } = await seedConversations(request);
      await page.goto('/');
      await sendMessage(page, '新しい会話の最初の質問');
      await expect(page.getByLabel('応答を生成中')).toBeVisible();

      await openConversation(page, '会話B');

      await expect(main(page).getByText(B_ANSWER)).toBeVisible();
      await expect(main(page).getByText('新しい会話の最初の質問')).toHaveCount(
        0
      );

      chat.release();

      // 作られた会話（タイトルは自動生成で変わりうるため、会話 A・B 以外で探す）に応答が保存される
      await expect
        .poll(
          async () => {
            const conversations = await fetchConversations(request);
            const created = conversations.find(
              (c) => c.title !== '会話A' && c.id !== b.id
            );
            if (!created) return [];
            return (await fetchMessages(request, created.id)).map(
              (m) => m.content
            );
          },
          { timeout: 10000 }
        )
        .toEqual(['新しい会話の最初の質問', DELAYED_ANSWER]);
      // 裏で届いた応答は、表示中の会話 B に混ざらない
      await expect(main(page).getByText(DELAYED_ANSWER)).toHaveCount(0);
    });

    test('生成中の会話にだけサイドバーの印が付き、生成が終わると消える', async ({
      page,
      request,
    }) => {
      const chat = await holdChat(page, {
        contentType: 'text/plain; charset=utf-8',
        body: DELAYED_ANSWER,
      });
      await seedConversations(request);
      await page.goto('/');
      await openConversation(page, '会話A');
      await expect(main(page).getByText(A_ANSWER)).toBeVisible();
      await sendMessage(page, '会話Aの続きの質問');

      await expect(generatingMark(page, '会話A')).toBeVisible();
      await expect(generatingMark(page, '会話B')).toHaveCount(0);

      // 別の会話を見ていても、裏で生成中であることがわかる
      await openConversation(page, '会話B');
      await expect(main(page).getByText(B_ANSWER)).toBeVisible();
      await expect(generatingMark(page, '会話A')).toBeVisible();

      chat.release();

      await expect(generatingMark(page, '会話A')).toBeHidden();
    });
  });

  test.describe('異常系', () => {
    test('生成中の会話を削除すると、生成を止めて応答を保存せず、どこにもエラーを出さない', async ({
      page,
      request,
    }) => {
      const chat = await holdChat(page, {
        contentType: 'text/plain; charset=utf-8',
        body: DELAYED_ANSWER,
      });
      const { a } = await seedConversations(request);
      // 削除した会話への応答の保存（POST）を数える
      const savesToDeleted: string[] = [];
      page.on('request', (req) => {
        if (
          req.method() === 'POST' &&
          new URL(req.url()).pathname === `/api/conversations/${a.id}/messages`
        ) {
          savesToDeleted.push(req.postDataJSON()?.role);
        }
      });
      await page.goto('/');
      await openConversation(page, '会話A');
      await expect(main(page).getByText(A_ANSWER)).toBeVisible();
      await sendMessage(page, '会話Aの続きの質問');
      await expect(page.getByLabel('応答を生成中')).toBeVisible();
      await openConversation(page, '会話B');
      await expect(main(page).getByText(B_ANSWER)).toBeVisible();

      await page.getByRole('button', { name: '「会話A」を削除' }).click();

      await expect(
        page.locator('aside').getByText('会話A', { exact: true })
      ).toHaveCount(0);
      await expect.poll(() => chat.aborted).toBe(true);
      // 止めておいた応答を手放しても届かず、保存もエラー表示も起きない
      chat.release();
      await page.waitForTimeout(1000);
      expect(savesToDeleted).toEqual(['user']);
      await expect(main(page).getByText(B_ANSWER)).toBeVisible();
      await expect(main(page).getByText(DELAYED_ANSWER)).toHaveCount(0);
      await expect(page.getByText('保存に失敗しました')).toHaveCount(0);
      await expect(stopButton(page)).toBeHidden();
    });

    test('裏の会話で起きたエラーは、表示中の会話には出ず、元の会話に戻ると表示される', async ({
      page,
      request,
    }) => {
      const chat = await holdChat(page, {
        status: 500,
        json: { error: 'テスト用の生成エラー' },
      });
      await seedConversations(request);
      await page.goto('/');
      await openConversation(page, '会話A');
      await expect(main(page).getByText(A_ANSWER)).toBeVisible();
      await sendMessage(page, '会話Aの続きの質問');
      await expect(page.getByLabel('応答を生成中')).toBeVisible();
      await openConversation(page, '会話B');
      await expect(main(page).getByText(B_ANSWER)).toBeVisible();

      chat.release();

      await expect.poll(() => chat.fulfilled).toBe(true);
      // エラーの応答が画面に届いて処理されるのを待ってから、出ていないことを確かめる
      await page.waitForTimeout(500);
      await expect(page.getByText('テスト用の生成エラー')).toHaveCount(0);

      await openConversation(page, '会話A');
      await expect(page.getByText('テスト用の生成エラー')).toBeVisible();
    });
  });
});
