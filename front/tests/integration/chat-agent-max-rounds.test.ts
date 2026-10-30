import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  vi,
} from 'vitest';
import type { NextRequest } from 'next/server';
import type { AgentStreamEvent } from '@/lib/agent/tools/types';
import { jsonRequest } from './helpers/db';
import { ollamaStreamResponse, stubFetch } from './helpers/ollama-stub';

/**
 * `/api/chat`（エージェント経路）の最大ラウンド到達時の IT（#96）。
 *
 * Ollama を「毎回ツール呼び出しを返す」fetch スタブにして上限まで回し、取得済みの
 * ツール結果を捨てずに最終回答（ツールを渡さない問い合わせ）へ進む契約を検証する。
 * 実 LLM では上限到達を決定的に起こせないため、この経路は IT で担保する。DB は使わない。
 */
const URL = 'http://localhost/api/chat';

// 上限を小さくして、ツール呼び出しのラウンドを短く回す。agent.ts はこの値をモジュール
// 読み込み時に確定するため、環境変数を設定した後に route を動的 import する
// （上限の値ごとにファイルを分けるのはこのため。ファイルごとにモジュールは隔離される）
const MAX_ROUNDS = 2;

// 外部通信をしないローカルツール。ツール実行の成否に左右されず上限まで回せる
const TOOL_NAME = 'get_current_datetime';

let POST: (request: NextRequest) => Promise<Response>;

beforeAll(async () => {
  vi.stubEnv('AGENT_MAX_TOOL_ROUNDS', String(MAX_ROUNDS));
  ({ POST } = await import('@/app/api/chat/route'));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * ツール呼び出しを要求する Ollama 応答（tool_calls は done=true のチャンクに含まれる）。
 *
 * @returns tool_calls を含む NDJSON ストリームの `Response`
 */
function toolCallResponse(): Response {
  const line = JSON.stringify({
    model: 'test',
    message: {
      role: 'assistant',
      content: '',
      tool_calls: [{ function: { name: TOOL_NAME, arguments: {} } }],
    },
    done: true,
  });
  return new Response(line + '\n', {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' },
  });
}

/**
 * Ollama への問い合わせを捌くスタブ。ツールが渡された問い合わせには常にツール呼び出しを
 * 返し（上限まで止まらない LLM を再現）、ツールが渡されない問い合わせ（最終回答）には
 * `finalAnswer` の応答を返す。
 *
 * @param finalAnswer - 最終回答の問い合わせに返すレスポンス
 * @returns スタブした fetch のモック関数（呼び出し記録で送信ボディを検証する）
 */
function stubNeverEndingToolCalls(finalAnswer: () => Response) {
  return stubFetch((_url, init) => {
    const body = JSON.parse(String(init?.body));
    return body.tools ? toolCallResponse() : finalAnswer();
  });
}

/**
 * エージェント経路でメッセージを送り、NDJSON を読み切ってイベント列に変換する。
 *
 * @returns 受信した `AgentStreamEvent` の配列（受信順）
 */
async function runAgent(): Promise<AgentStreamEvent[]> {
  const res = await POST(
    jsonRequest(URL, 'POST', { message: '調べて', enableTools: true })
  );
  expect(res.status).toBe(200);
  const body = await res.text();
  return body
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as AgentStreamEvent);
}

/**
 * イベント列の text_delta を連結して、クライアントが表示・保存する本文を得る。
 *
 * @param events - `runAgent` が返したイベント列
 * @returns 連結した本文
 */
function textOf(events: AgentStreamEvent[]): string {
  return events.map((e) => (e.type === 'text_delta' ? e.content : '')).join('');
}

/**
 * イベント列の末尾の done イベントを取り出す。
 *
 * @param events - `runAgent` が返したイベント列
 * @returns done イベント
 */
function doneOf(events: AgentStreamEvent[]) {
  const last = events.at(-1);
  expect(last?.type).toBe('done');
  // 直前の expect で done であることを確定させたうえで、そのバリアントに型を合わせる
  return last as Extract<AgentStreamEvent, { type: 'done' }>;
}

describe('POST /api/chat（エージェント・最大ラウンド到達）', () => {
  describe('正常系', () => {
    it('上限に達しても error にせず、注記と最終回答を返し、ツール結果を done に残す', async () => {
      stubNeverEndingToolCalls(() =>
        ollamaStreamResponse(['取得した日時は', '以上です'])
      );

      const events = await runAgent();

      expect(events.some((e) => e.type === 'error')).toBe(false);
      const text = textOf(events);
      expect(text).toContain(
        `ツール呼び出しの上限（${MAX_ROUNDS} 回）に達した`
      );
      expect(text).toContain('取得した日時は以上です');
      // 注記が最終回答より先に流れる
      expect(text.indexOf('上限')).toBeLessThan(text.indexOf('取得した日時'));

      const done = doneOf(events);
      expect(done.metadata?.toolCalls).toHaveLength(MAX_ROUNDS);
      expect(done.metadata?.toolCalls?.every((t) => t.name === TOOL_NAME)).toBe(
        true
      );
      // 問い合わせ回数 = ツール呼び出しのラウンド + 最終回答の 1 回
      expect(done.metadata?.agentRounds).toBe(MAX_ROUNDS + 1);
    });

    it('最終回答の問い合わせにはツールを渡さず、取得済みのツール結果と回答の指示を送る', async () => {
      const fetchMock = stubNeverEndingToolCalls(() =>
        ollamaStreamResponse(['回答'])
      );

      await runAgent();

      const bodies = fetchMock.mock.calls.map(([, init]) =>
        JSON.parse(String(init?.body))
      );
      expect(bodies).toHaveLength(MAX_ROUNDS + 1);
      expect(bodies.slice(0, MAX_ROUNDS).every((b) => b.tools)).toBe(true);

      const final = bodies[MAX_ROUNDS];
      expect(final.tools).toBeUndefined();
      const roles = final.messages.map((m: { role: string }) => m.role);
      expect(roles.filter((r: string) => r === 'tool')).toHaveLength(
        MAX_ROUNDS
      );
      // 回答の指示は履歴の末尾に user の発言として付く
      const last = final.messages.at(-1);
      expect(last.role).toBe('user');
      expect(last.content).toContain('これまでのツール実行結果だけを使って');
    });
  });

  describe('準正常系', () => {
    it('最終回答が空なら、生成に失敗した旨を本文にして done で閉じる', async () => {
      stubNeverEndingToolCalls(() => ollamaStreamResponse(['   ']));
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

      const events = await runAgent();

      expect(events.some((e) => e.type === 'error')).toBe(false);
      expect(textOf(events)).toContain('最終回答の生成に失敗しました');
      expect(doneOf(events).metadata?.toolCalls).toHaveLength(MAX_ROUNDS);
      errorLog.mockRestore();
    });
  });

  describe('異常系', () => {
    it('最終回答の問い合わせで Ollama がエラーを返しても、ツール結果を残して done で閉じる', async () => {
      stubNeverEndingToolCalls(
        () => new Response('model crashed', { status: 500 })
      );
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

      const events = await runAgent();

      // error を送るとクライアントが作成中のメッセージ（ツール結果ごと）を破棄するため、送らない
      expect(events.some((e) => e.type === 'error')).toBe(false);
      const text = textOf(events);
      expect(text).toContain('最終回答の生成に失敗しました');
      expect(text).toContain('500');
      const done = doneOf(events);
      expect(done.metadata?.toolCalls).toHaveLength(MAX_ROUNDS);
      expect(done.metadata?.agentRounds).toBe(MAX_ROUNDS + 1);
      // 失敗はサーバーのログに残す（スタックトレース付き）
      expect(errorLog).toHaveBeenCalled();
      errorLog.mockRestore();
    });
  });
});
