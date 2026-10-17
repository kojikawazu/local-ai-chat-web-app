import type { APIResponse } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { cleanupAllConversations } from './helpers/test-data';

const BASE_URL = 'http://localhost:3000';

/** NDJSON の 1 行。検証に使うフィールドだけを持つ（AgentStreamEvent の部分形） */
type StreamEvent = {
  type: string;
  name?: string;
  arguments?: Record<string, unknown>;
  result?: string;
  isError?: boolean;
};

/**
 * エージェント応答の NDJSON から url_fetch の実行結果を取り出し、取得が拒否されたことを検証する。
 *
 * 実 LLM はツールを呼ぶか・どの URL を渡すかが非決定的なため、**対象 URL を 1 回だけ
 * 取得しようとした場合に限り**結果の中身を検証する（呼ばなければ検証なしで通る）。
 * 結果が毎回同じになる検証は IT（`tests/integration/chat-agent.test.ts`）が担保する。
 *
 * @param res - `/api/chat`（enableTools=true）のレスポンス
 * @param target - LLM が url_fetch に渡すと期待する URL の一部
 */
async function expectUrlFetchRejected(res: APIResponse, target: string) {
  const events = (await res.text())
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as StreamEvent);
  const starts = events.filter(
    (e) => e.type === 'tool_call_start' && e.name === 'url_fetch'
  );
  const results = events.filter(
    (e) => e.type === 'tool_call_result' && e.name === 'url_fetch'
  );

  if (
    starts.length !== 1 ||
    !String(starts[0].arguments?.url ?? '').includes(target)
  ) {
    return;
  }
  expect(results).toHaveLength(1);
  // ツールは拒否理由を "エラー: ..." の文字列で返す（タイムアウト時は isError=true）
  const [{ result = '', isError }] = results;
  expect(isError || result.startsWith('エラー:')).toBe(true);
}

test.describe('エージェント Phase B — 調査系ツール', () => {
  test.setTimeout(180000);

  test.beforeAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllConversations(request);
  });

  test.describe('正常系', () => {
    test('GET /api/tools に web_search と url_fetch が含まれる', async ({
      request,
    }) => {
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
      test.skip(
        !!process.env.CI,
        'CI 環境では外部ネットワークアクセスが制限されるためスキップ'
      );

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

    test('url_fetch ツールがパブリック URL を取得できる', async ({
      request,
    }) => {
      test.skip(
        !!process.env.CI,
        'CI 環境では外部ネットワークアクセスが制限されるためスキップ'
      );

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
    test('url_fetch にプライベート IP を渡すとエラーが返る', async ({
      request,
    }) => {
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
      await expectUrlFetchRejected(res, '192.168.1.1');
    });

    test('url_fetch にローカルホストを渡すとエラーが返る', async ({
      request,
    }) => {
      const res = await request.post(`${BASE_URL}/api/chat`, {
        data: {
          message: 'http://localhost:3000 の内容を取得してください',
          conversationHistory: [],
          model: 'qwen3-coder:latest',
          enableTools: true,
        },
      });

      expect(res.status()).toBe(200);
      await expectUrlFetchRejected(res, 'localhost');
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
      await expectUrlFetchRejected(res, '/etc/passwd');
    });

    test('空メッセージで enableTools=true のとき API が 400 を返す', async ({
      request,
    }) => {
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
      await expectUrlFetchRejected(res, 'not-a-url');
    });

    test('enableTools=true かつ 10001 文字メッセージで 400 を返す', async ({
      request,
    }) => {
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
