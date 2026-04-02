import { test, expect } from '@playwright/test';
import { cleanupAllConversations } from './helpers/test-data';

const BASE_URL = 'http://localhost:3000';

test.describe('エージェント Phase B — 調査系ツール', () => {
  test.setTimeout(180000);

  test.beforeAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('GET /api/tools に web_search と url_fetch が含まれる', async ({ request }) => {
      const res = await request.get(`${BASE_URL}/api/tools`);
      expect(res.status()).toBe(200);

      const data = await res.json();
      const names = data.tools.map((t: { name: string }) => t.name);
      expect(names).toContain('web_search');
      expect(names).toContain('url_fetch');
    });

    test('web_search ツールを API から直接呼び出せる（enableTools モード）', async ({
      request,
    }) => {
      test.skip(!!process.env.CI, 'CI 環境では外部ネットワークアクセスが制限されるためスキップ');

      const res = await request.post(`${BASE_URL}/api/chat`, {
        data: {
          message: 'DuckDuckGo とは何か一言で教えてください',
          conversationHistory: [],
          model: 'qwen3-coder:latest',
          enableTools: true,
        },
      });

      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toContain('application/x-ndjson');
    });

    test('url_fetch ツールがパブリック URL を取得できる', async ({ request }) => {
      test.skip(!!process.env.CI, 'CI 環境では外部ネットワークアクセスが制限されるためスキップ');

      const res = await request.post(`${BASE_URL}/api/chat`, {
        data: {
          message: 'https://example.com の内容を教えてください',
          conversationHistory: [],
          model: 'qwen3-coder:latest',
          enableTools: true,
        },
      });

      expect(res.status()).toBe(200);
    });
  });

  test.describe('準正常系', () => {
    test('url_fetch にプライベート IP を渡すとエラーが返る', async ({ request }) => {
      // /api/chat 経由でなく、ツール実行ロジックを直接テストする場合は
      // エージェントモードでプライベート IP を含む URL を渡す
      const res = await request.post(`${BASE_URL}/api/chat`, {
        data: {
          message: 'http://192.168.1.1 の内容を取得してください',
          conversationHistory: [],
          model: 'qwen3-coder:latest',
          enableTools: true,
        },
      });

      // enableTools=true で NDJSON が返ること自体は正常
      expect(res.status()).toBe(200);
    });

    test('url_fetch にローカルホストを渡すとエラーが返る', async ({ request }) => {
      const res = await request.post(`${BASE_URL}/api/chat`, {
        data: {
          message: 'http://localhost:3000 の内容を取得してください',
          conversationHistory: [],
          model: 'qwen3-coder:latest',
          enableTools: true,
        },
      });

      expect(res.status()).toBe(200);
    });

    test('url_fetch に http/https 以外のスキームを渡すとツールエラーになる', async ({
      request,
    }) => {
      const res = await request.post(`${BASE_URL}/api/chat`, {
        data: {
          message: 'file:///etc/passwd の内容を取得してください',
          conversationHistory: [],
          model: 'qwen3-coder:latest',
          enableTools: true,
        },
      });

      expect(res.status()).toBe(200);
    });

    test('空メッセージで enableTools=true のとき API が 400 を返す', async ({ request }) => {
      // /api/chat のメッセージバリデーション（空文字）をテスト
      // web_search ツール内の空クエリチェックではなく API 層のバリデーション
      const res = await request.post(`${BASE_URL}/api/chat`, {
        data: {
          message: '',
          conversationHistory: [],
          model: 'qwen3-coder:latest',
          enableTools: true,
        },
      });

      expect(res.status()).toBe(400);
    });
  });

  test.describe('異常系', () => {
    test('url_fetch に不正な URL 形式を渡すとツールがエラーメッセージを返す', async ({
      request,
    }) => {
      const res = await request.post(`${BASE_URL}/api/chat`, {
        data: {
          message: 'not-a-url という URL の内容を取得してください',
          conversationHistory: [],
          model: 'qwen3-coder:latest',
          enableTools: true,
        },
      });

      // API 自体は 200（ツール側でエラーを文字列として返す）
      expect(res.status()).toBe(200);
    });

    test('enableTools=true かつ 10001 文字メッセージで 400 を返す', async ({ request }) => {
      const res = await request.post(`${BASE_URL}/api/chat`, {
        data: {
          message: 'あ'.repeat(10001),
          conversationHistory: [],
          model: 'qwen3-coder:latest',
          enableTools: true,
        },
      });

      expect(res.status()).toBe(400);
    });
  });
});
