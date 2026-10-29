import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  vi,
} from 'vitest';
import { mkdtemp, realpath, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import type { NextRequest } from 'next/server';
import type { AgentStreamEvent } from '@/lib/agent/tools/types';
import { jsonRequest, routeContext } from './helpers/db';
import { stubFetch, ollamaStreamResponse } from './helpers/ollama-stub';
import {
  installFakeGh,
  readFakeGhCalls,
  setFakeGhRules,
} from './helpers/fake-gh';
import type { FakeGhRule } from './helpers/fake-gh';

/**
 * GitHub のツール（#148 Phase C。`docs/17-github-tools.md`）の IT。
 *
 * `GITHUB_REPOS` を設定して route を読み込み、Ollama を fetch スタブで、`gh` を偽の gh（helpers/fake-gh.ts）で差し替える
 * （どちらも真の外部。本物の GitHub には触れない）。`/api/chat` のストリームを読み、承認の依頼には承認の API で答えて、
 * 読むツールは承認なしで決まった引数で `gh` を呼ぶ・書くツールは承認カードの内容を送り許可で呼び拒否で呼ばない・
 * 検証で断ったら `gh` を呼ばない・`gh` の失敗の扱い・GitHub を読んだ後は外部と通信するツールを止める、を確かめる。
 * この経路は DB を使わない。
 */
const CHAT_URL = 'http://localhost/api/chat';
const APPROVAL_URL = 'http://localhost/api/agent/approvals/x';
const REPO = 'octo-org/app';

/** テスト用の偽のトークン。`gh` に渡らないことを確かめる（値は本物ではない） */
const DUMMY_TOKEN = 'dummy-token-for-it';

/** 偽の gh を置くフォルダ */
let ghDir: string;
/** 何も置かない空のフォルダ（gh が見つからない場合の PATH） */
let emptyDir: string;
/** テストを動かす node のフォルダ（偽の gh の `#!/usr/bin/env node` が node を見つけるため） */
let nodeDir: string;
let POST_CHAT: (request: NextRequest) => Promise<Response>;
let POST_APPROVAL: (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => Promise<Response>;
let GET_TOOLS: () => Promise<Response>;

/** 既定の偽の gh の応答。先に書いたものが優先（`pr list --head=…` は、ほかの `pr list` より前に置く） */
const DEFAULT_RULES: FakeGhRule[] = [
  {
    args: ['repo', 'view', REPO],
    stdout: JSON.stringify({
      visibility: 'PUBLIC',
      defaultBranchRef: { name: 'main' },
    }),
  },
  { args: ['pr', 'list', '--repo', REPO, '--head=feature/x'], stdout: '[]' },
  {
    args: ['pr', 'list', '--repo', REPO, '--head=feature/dup'],
    stdout: JSON.stringify([
      { number: 77, url: 'https://github.com/octo-org/app/pull/77' },
    ]),
  },
  {
    args: ['pr', 'list'],
    stdout: JSON.stringify([
      {
        number: 193,
        title: 'ツールを足す',
        state: 'OPEN',
        author: { login: 'alice' },
        headRefName: 'feature/x',
        baseRefName: 'main',
        updatedAt: '2026-10-29T00:00:00Z',
      },
    ]),
  },
  {
    args: ['pr', 'view', '193'],
    stdout: JSON.stringify({ number: 193, title: 'ツールを足す', body: '' }),
  },
  {
    args: ['pr', 'view', '999'],
    stderr:
      'GraphQL: Could not resolve to a PullRequest with the number of 999. (repository.pullRequest)\n',
    exitCode: 1,
  },
  { args: ['issue', 'view', '5'], stdout: JSON.stringify({ title: '質問' }) },
  {
    args: ['issue', 'comment'],
    stdout: 'https://github.com/octo-org/app/issues/5#issuecomment-1\n',
  },
  {
    args: ['pr', 'diff', '7'],
    stdout: [
      'diff --git a/src/a.ts b/src/a.ts',
      '+a',
      'diff --git a/src/b.ts b/src/b.ts',
      '+only-b',
      '',
    ].join('\n'),
  },
  {
    args: ['pr', 'create'],
    stdout: 'https://github.com/octo-org/app/pull/200\n',
  },
];

beforeAll(async () => {
  ghDir = await realpath(await mkdtemp(path.join(tmpdir(), 'fake-gh-it-')));
  emptyDir = await realpath(await mkdtemp(path.join(tmpdir(), 'no-gh-it-')));
  nodeDir = path.dirname(process.execPath);
  await installFakeGh(ghDir, DEFAULT_RULES);
  // registry.ts は環境変数を初めて使うときに読むため、設定してから route を読み込む
  vi.stubEnv('GITHUB_REPOS', REPO);
  vi.stubEnv('GH_TOKEN', DUMMY_TOKEN);
  // 偽の gh を先頭に置き、本物の gh より先に見つかるようにする
  vi.stubEnv(
    'PATH',
    [ghDir, nodeDir, process.env.PATH ?? ''].join(path.delimiter)
  );
  ({ POST: POST_CHAT } = await import('@/app/api/chat/route'));
  ({ POST: POST_APPROVAL } =
    await import('@/app/api/agent/approvals/[id]/route'));
  ({ GET: GET_TOOLS } = await import('@/app/api/tools/route'));
});

beforeEach(async () => {
  await setFakeGhRules(ghDir, DEFAULT_RULES);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(ghDir, { recursive: true, force: true });
  await rm(emptyDir, { recursive: true, force: true });
});

/**
 * ツールの呼び出しだけを返す Ollama の応答（NDJSON 1 行）を作る。
 *
 * @param name - 呼ぶツール名
 * @param args - ツールへ渡す引数
 * @returns Ollama の応答
 */
function toolCallResponse(name: string, args: Record<string, unknown>) {
  const line = JSON.stringify({
    model: 'test',
    message: {
      role: 'assistant',
      content: '',
      tool_calls: [{ function: { name, arguments: args } }],
    },
    done: true,
  });
  return new Response(line + '\n', {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' },
  });
}

/**
 * 1 ラウンドに 1 つずつ順にツールを呼び、最後に「完了」と答える Ollama をスタブする。
 *
 * @param calls - 呼ぶツール（呼ぶ順）
 */
function stubToolCalls(
  ...calls: { name: string; args: Record<string, unknown> }[]
) {
  let round = 0;
  stubFetch(() => {
    const call = calls[round++];
    return call
      ? toolCallResponse(call.name, call.args)
      : ollamaStreamResponse(['完了']);
  });
}

/**
 * エージェント経路で送信し、ストリームを最後まで読む。承認の依頼が届いたら `approved` で答える。
 *
 * @param approved - 承認の依頼に許可で答えるか（省略時は許可）
 * @returns 受け取ったイベント（受信順）
 */
async function runAgent(approved = true) {
  const res = await POST_CHAT(
    jsonRequest(CHAT_URL, 'POST', {
      message: 'GitHub を見て',
      enableTools: true,
    })
  );
  expect(res.status).toBe(200);
  const reader = res.body!.getReader(); // 200 の NDJSON 応答は必ず本文を持つ
  const decoder = new TextDecoder();
  const events: AgentStreamEvent[] = [];
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines.filter((l) => l.trim())) {
      const event = JSON.parse(line) as AgentStreamEvent;
      events.push(event);
      if (event.type !== 'tool_approval_request') continue;
      const decided = await POST_APPROVAL(
        jsonRequest(APPROVAL_URL, 'POST', { approved }),
        routeContext(event.approvalId)
      );
      expect(decided.status).toBe(204);
    }
  }
  return events;
}

/**
 * イベント列から、あるツールの実行結果を取り出す（同じツールが何度も呼ばれたら `index` 番目）。
 *
 * @param events - イベント列
 * @param name - ツール名
 * @param index - 何番目の結果か（0 始まり）
 * @returns そのツールの tool_call_result
 */
function resultOf(events: AgentStreamEvent[], name: string, index = 0) {
  return events.filter(
    (event): event is Extract<AgentStreamEvent, { type: 'tool_call_result' }> =>
      event.type === 'tool_call_result' && event.name === name
  )[index];
}

/**
 * 承認の依頼のイベントを取り出す。
 *
 * @param events - イベント列
 * @returns tool_approval_request（無ければ undefined）
 */
function approvalOf(events: AgentStreamEvent[]) {
  return events.find((event) => event.type === 'tool_approval_request');
}

describe('POST /api/chat（GitHub のツール）', () => {
  describe('正常系', () => {
    it('読むツールは承認なしで、アプリが組み立てた引数で gh を呼ぶ（一時フォルダで・トークン等の環境変数を渡さずに）', async () => {
      stubToolCalls({
        name: 'github_list',
        args: { repo: 'OCTO-ORG/APP', kind: 'pr', limit: '3' },
      });

      const events = await runAgent();

      expect(approvalOf(events)).toBeUndefined();
      expect(resultOf(events, 'github_list')).toMatchObject({
        isError: false,
        summary: 'PR 1 件',
      });
      const [call] = await readFakeGhCalls(ghDir);
      expect(call.args.slice(0, 9)).toEqual([
        'pr',
        'list',
        '--repo',
        REPO,
        '--state',
        'open',
        '--limit',
        '3',
        '--json',
      ]);
      expect(call.cwd).toBe(await realpath(tmpdir()));
      expect(call.envKeys).toEqual(
        expect.arrayContaining(['GH_NO_UPDATE_NOTIFIER', 'GH_PROMPT_DISABLED'])
      );
      expect(call.envKeys).not.toContain('GH_TOKEN');
      expect(call.envKeys).not.toContain('GITHUB_REPOS');
      expect(call.envKeys).not.toContain('DATABASE_URL');
    });

    it('コメントは承認カードに本文・コメント先・公開を出し、許可されたら --body=… で送る', async () => {
      // - で始まる本文も、フラグではなく本文として渡ることを確かめる
      stubToolCalls({
        name: 'github_comment',
        args: {
          repo: REPO,
          kind: 'issue',
          number: '#5',
          body: '-確認しました',
        },
      });

      const events = await runAgent();

      expect(approvalOf(events)).toMatchObject({
        name: 'github_comment',
        preview: {
          action: 'github-comment',
          repo: REPO,
          visibility: 'public',
          kind: 'issue',
          number: 5,
          targetTitle: '質問',
          body: '-確認しました',
        },
      });
      expect(resultOf(events, 'github_comment')).toMatchObject({
        isError: false,
        approval: 'approved',
        summary: 'issue #5 にコメント',
      });
      const calls = await readFakeGhCalls(ghDir);
      expect(calls.at(-1)?.args).toEqual([
        'issue',
        'comment',
        '5',
        '--repo',
        REPO,
        '--body=-確認しました',
      ]);
    });

    it('PR の作成は、base を省略したら既定のブランチにし、許可されたら --flag=… の形で作る', async () => {
      stubToolCalls({
        name: 'github_create_pr',
        args: {
          repo: REPO,
          head: 'feature/x',
          title: 'ツールを足す',
          body: '本文',
          draft: true,
        },
      });

      const events = await runAgent();

      expect(approvalOf(events)).toMatchObject({
        preview: {
          action: 'github-create-pr',
          head: 'feature/x',
          base: 'main',
          draft: true,
        },
      });
      expect(resultOf(events, 'github_create_pr')).toMatchObject({
        approval: 'approved',
        summary: 'PR #200 を作成',
      });
      const calls = await readFakeGhCalls(ghDir);
      expect(calls.at(-1)?.args).toEqual([
        'pr',
        'create',
        '--repo',
        REPO,
        '--head=feature/x',
        '--base=main',
        '--title=ツールを足す',
        '--body=本文',
        '--draft',
      ]);
    });

    it('PR の差分は --color=never で取り、file はアプリの中で絞る（gh には渡さない）', async () => {
      stubToolCalls({
        name: 'github_pr_diff',
        args: { repo: REPO, number: 7, file: 'src/b.ts' },
      });

      const events = await runAgent();

      expect(approvalOf(events)).toBeUndefined();
      const result = resultOf(events, 'github_pr_diff');
      expect(result).toMatchObject({
        isError: false,
        summary: 'src/b.ts の差分',
      });
      expect(result?.result).toContain('+only-b');
      expect(result?.result).not.toContain('src/a.ts');
      const [call] = await readFakeGhCalls(ghDir);
      expect(call.args).toEqual([
        'pr',
        'diff',
        '7',
        '--repo',
        REPO,
        '--color=never',
      ]);
    });

    it('GitHub を読んだ後は、その応答で外部と通信するツールを止める', async () => {
      stubToolCalls(
        { name: 'github_view', args: { repo: REPO, kind: 'pr', number: 193 } },
        { name: 'url_fetch', args: { url: 'https://example.com/' } }
      );

      const events = await runAgent();

      expect(resultOf(events, 'github_view')?.isError).toBe(false);
      expect(resultOf(events, 'url_fetch')).toMatchObject({
        isError: true,
        summary: expect.stringContaining('GitHub の内容を読んだ後のため'),
      });
    });
  });

  describe('準正常系', () => {
    it('コメントを拒否したら gh でコメントしない', async () => {
      stubToolCalls({
        name: 'github_comment',
        args: { repo: REPO, kind: 'issue', number: 5, body: 'x' },
      });

      const events = await runAgent(false);

      expect(resultOf(events, 'github_comment')).toMatchObject({
        isError: true,
        approval: 'rejected',
      });
      const calls = await readFakeGhCalls(ghDir);
      expect(calls.some((call) => call.args[1] === 'comment')).toBe(false);
    });

    it.each([
      [
        '許可していないリポジトリ',
        'github_list',
        { repo: 'evil/repo', kind: 'pr' },
        '扱うことが許可されていません',
      ],
      [
        'フラグに見えるブランチ名',
        'github_create_pr',
        { repo: REPO, head: '--repo=evil/repo', title: 't', body: 'b' },
        'ブランチ名として使えません',
      ],
      [
        '番号でない値',
        'github_view',
        { repo: REPO, kind: 'pr', number: 'latest' },
        '番号',
      ],
    ])(
      '%s は gh を呼ばずに断り、承認も求めない',
      async (_, name, args, reason) => {
        stubToolCalls({ name, args });

        const events = await runAgent();

        expect(approvalOf(events)).toBeUndefined();
        expect(resultOf(events, name)).toMatchObject({
          isError: true,
          result: expect.stringContaining(reason),
        });
        expect(await readFakeGhCalls(ghDir)).toEqual([]);
      }
    );

    it('同じブランチの開いた PR があれば、承認を求めずにその PR を返す', async () => {
      stubToolCalls({
        name: 'github_create_pr',
        args: { repo: REPO, head: 'feature/dup', title: 't', body: 'b' },
      });

      const events = await runAgent();

      expect(approvalOf(events)).toBeUndefined();
      expect(resultOf(events, 'github_create_pr')).toMatchObject({
        isError: true,
        summary: expect.stringContaining('PR #77'),
      });
    });
  });

  describe('異常系', () => {
    it('gh が失敗したら、エラーの文を付けて ❌ にし、見出しには 1 行目を出す', async () => {
      stubToolCalls({
        name: 'github_view',
        args: { repo: REPO, kind: 'pr', number: 999 },
      });

      const events = await runAgent();

      expect(resultOf(events, 'github_view')).toMatchObject({
        isError: true,
        summary: expect.stringContaining('Could not resolve to a PullRequest'),
        result: expect.stringContaining('終了コード 1'),
      });
    });

    it('ログインしていない（終了コード 4）ならログインを促し、同じ応答ではそのツールを再び実行しない', async () => {
      await setFakeGhRules(ghDir, [
        { args: ['pr', 'list'], stderr: 'not logged in\n', exitCode: 4 },
      ]);
      const list = { name: 'github_list', args: { repo: REPO, kind: 'pr' } };
      stubToolCalls(list, list);

      const events = await runAgent();

      expect(resultOf(events, 'github_list', 0)).toMatchObject({
        isError: true,
        summary: expect.stringContaining('gh auth login'),
      });
      expect(resultOf(events, 'github_list', 1)?.summary).toContain(
        '先の呼び出しで使えないとわかったため'
      );
      expect(await readFakeGhCalls(ghDir)).toHaveLength(1);
    });

    it('gh が見つからなければ、GitHub CLI を入れるよう返す', async () => {
      vi.stubEnv('PATH', emptyDir);
      try {
        stubToolCalls({
          name: 'github_list',
          args: { repo: REPO, kind: 'issue' },
        });

        const events = await runAgent();

        expect(resultOf(events, 'github_list')).toMatchObject({
          isError: true,
          summary: expect.stringContaining('見つかりません'),
        });
      } finally {
        vi.stubEnv(
          'PATH',
          [ghDir, nodeDir, process.env.PATH ?? ''].join(path.delimiter)
        );
      }
    });
  });
});

describe('GET /api/tools（GITHUB_REPOS あり）', () => {
  describe('正常系', () => {
    it('GitHub の 5 つのツールが一覧に出る', async () => {
      const { tools } = await (await GET_TOOLS()).json();
      expect(tools.map((tool: { name: string }) => tool.name)).toEqual(
        expect.arrayContaining([
          'github_list',
          'github_view',
          'github_pr_diff',
          'github_comment',
          'github_create_pr',
        ])
      );
    });
  });

  // 準正常系（GITHUB_REPOS が無ければ出ない）は tools.test.ts で確かめる。
  // 異常系: 引数を取らない GET で、入力起因の失敗経路が無い
});
