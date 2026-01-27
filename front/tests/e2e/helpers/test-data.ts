import { APIRequestContext, Page } from '@playwright/test';

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
    // 長いテキスト: クリップボードに書き込んで貼り付け
    await page.evaluate(async (t) => {
      await navigator.clipboard.writeText(t);
    }, text);
    await page.keyboard.press('ControlOrMeta+v');
    // React stateの更新を待つ
    await page.waitForTimeout(200);
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
  content: string
): Promise<TestMessage> {
  const res = await request.post(
    `${BASE_URL}/api/conversations/${conversationId}/messages`,
    { data: { role, content } }
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

export async function cleanupAllConversations(
  request: APIRequestContext
): Promise<void> {
  const conversations = await fetchConversations(request);
  for (const conv of conversations) {
    await deleteConversation(request, conv.id);
  }
}
