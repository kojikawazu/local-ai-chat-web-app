import type { APIRequestContext, APIResponse, Page } from '@playwright/test';
import { expect } from '@playwright/test';

const BASE_URL = 'http://localhost:3000';

export interface TestConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface TestMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

/**
 * React controlled input にテキストを設定するヘルパー。
 * React 19 + React Compiler では fill() や insertText() では state が更新されない。
 * pressSequentially() は keydown/input/keyup イベントを発火し React が検知できる。
 * 長いテキストにはクリップボード貼り付けを使用する。
 */
export async function fillTextarea(page: Page, text: string) {
  const textarea = page.locator('textarea');
  await textarea.click();

  if (text.length <= 200) {
    // 短いテキスト: pressSequentially で確実にReact stateを更新
    await textarea.pressSequentially(text, { delay: 10 });
  } else {
    // 長いテキスト: evaluateで直接値を設定し、inputイベントを発火
    await textarea.focus();
    await page.evaluate(
      ({ selector, t }) => {
        const el = document.querySelector(selector) as HTMLTextAreaElement;
        if (!el) return;
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          'value'
        )?.set;
        nativeInputValueSetter?.call(el, t);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      },
      { selector: 'textarea', t: text }
    );
    // React stateの更新を待つ
    await page.waitForTimeout(300);
  }
}

/**
 * テキストを入力して Enter で送信するヘルパー。
 */
export async function sendMessage(page: Page, text: string) {
  await fillTextarea(page, text);
  // fillTextarea後、Reactのstate更新が反映されるのを待つ
  await page.waitForTimeout(100);
  await page.locator('textarea').press('Enter');
}

/** 完了待ちのために入力する文字。1 文字なので、`waitForResponseComplete` の最後の Backspace 1 回で消える */
const PROBE_TEXT = '.';

/**
 * AI 応答の生成が終わるまで待つ。送信の直後に呼ぶ。
 *
 * 送信ボタンは「入力欄が空でない」かつ「生成中でない」ときだけ有効になる（`ChatBar` の `canSend`）。
 * 送信すると入力欄は空になるため、そのままボタンを待っても有効にならない（#115）。
 * そこで 1 文字入力し、ボタンが有効になる＝生成が終わった、と判定する。入力した文字は送らずに消す。
 *
 * 生成中インジケーター（`aria-label="応答を生成中"`）は最初のチャンクを待つ間しか出ないため、
 * 完了の判定には使えない。
 *
 * @param page - 対象のページ
 * @param timeout - 生成の完了を待つ上限（ms）。既定は 120 秒
 */
export async function waitForResponseComplete(page: Page, timeout = 120000) {
  await fillTextarea(page, PROBE_TEXT);
  await expect(page.locator('button[type="submit"]')).toBeEnabled({ timeout });
  await page.locator('textarea').press('Backspace');
}

export async function createConversation(
  request: APIRequestContext,
  title?: string
): Promise<TestConversation> {
  const res = await request.post(`${BASE_URL}/api/conversations`, {
    data: { title: title || 'テスト会話' },
  });
  return res.json();
}

export async function deleteConversation(
  request: APIRequestContext,
  id: string
): Promise<void> {
  await request.delete(`${BASE_URL}/api/conversations/${id}`);
}

export async function fetchConversations(
  request: APIRequestContext
): Promise<TestConversation[]> {
  const res = await request.get(`${BASE_URL}/api/conversations`);
  const data = await res.json();
  return data.conversations;
}

export async function createMessage(
  request: APIRequestContext,
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  metadata?: Record<string, unknown>
): Promise<TestMessage> {
  const res = await request.post(
    `${BASE_URL}/api/conversations/${conversationId}/messages`,
    { data: { role, content, metadata } }
  );
  return res.json();
}

export async function fetchMessages(
  request: APIRequestContext,
  conversationId: string
): Promise<TestMessage[]> {
  const res = await request.get(
    `${BASE_URL}/api/conversations/${conversationId}/messages`
  );
  const data = await res.json();
  return data.messages;
}

/**
 * `/api/chat` に POST し、Ollama バックエンドの一時的な障害をリトライで吸収するヘルパー。
 *
 * CI ランナー（CPU only）では llama-server が segfault して Route Handler が 5xx を
 * 返すことがある。この障害は再起動で回復し得るため、5xx のときのみ間隔を空けて再試行する。
 * バリデーション由来の 4xx はテストの検証対象そのものなので即座に返す（リトライしない）。
 * 全試行が 5xx なら最後のレスポンスを返すため、Ollama が本当に死んでいればテストは
 * 正しく失敗する（バックエンド障害を握り潰さない）。
 *
 * @param request - Playwright の APIRequestContext
 * @param data - `/api/chat` へ送るリクエストボディ
 * @param maxAttempts - 最大試行回数（デフォルト 3）
 * @returns 最後に受け取った APIResponse（4xx なら初回のもの）
 */
export async function postChatWithRetry(
  request: APIRequestContext,
  data: Record<string, unknown>,
  maxAttempts = 3
): Promise<APIResponse> {
  let res!: APIResponse;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    res = await request.post(`${BASE_URL}/api/chat`, { data });
    // 5xx（Ollama バックエンド障害）以外は確定結果として即返す
    if (res.status() < 500) return res;
    if (attempt < maxAttempts) {
      // llama-server の再起動を待ってから再試行
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  return res;
}

export async function cleanupAllConversations(
  request: APIRequestContext
): Promise<void> {
  const conversations = await fetchConversations(request);
  for (const conv of conversations) {
    await deleteConversation(request, conv.id);
  }
}
