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
import { execFileSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { NextRequest } from 'next/server';
import type { AgentStreamEvent, Tool } from '@/lib/agent/tools/types';
import type { VaultRoot } from '@/lib/knowledge/vault';
import { formatMemoryDate } from '@/lib/knowledge/memory';
import type { MemoryApprovalPreview } from '@/types/agent/tool-call';
import { prisma, resetDb, jsonRequest, routeContext } from './helpers/db';
import { stubFetch } from './helpers/ollama-stub';

/**
 * 会話から覚えさせたことをメモの保管庫に書く `save_memory`（#236。`docs/28-rag.md`「会話から覚えさせる（Phase D）」）の IT。
 *
 * 一時フォルダに本物の git のリポジトリ（メモの保管庫・別のブランチをチェックアウトしたもの）とふつうのフォルダを作って
 * `KNOWLEDGE_VAULTS`・`KNOWLEDGE_MEMORY_VAULT` に渡す。ツールの準備（承認で見せる内容）と実行（書き込み・main への
 * コミット・索引への反映）を実 PostgreSQL（pgvector）に通し、`/api/chat` の承認の流れも 1 本通す。
 * Ollama（チャットと `/api/embed`）だけをスタブにする。git は手元で動かす実依存で、差し替えない。
 */
const CHAT_URL = 'http://localhost/api/chat';
const APPROVAL_URL = 'http://localhost/api/agent/approvals/x';

/** スタブの埋め込み（どの文にも同じベクトル。検索では比べる範囲に入ったものが全部同じ近さになる） */
const VECTOR = [1, 0, 0, 0];

/** 正しい引数 */
const ARGS = {
  name: 'coffee-preference',
  description: '朝はブラックのコーヒーを飲む',
  type: 'preference',
  content: '朝はブラックのコーヒーを飲む。砂糖・ミルクは入れない。',
};

let workspace: string;
/** メモの保管庫（git。名前 `memory`。`KNOWLEDGE_MEMORY_VAULT`） */
let memory: string;
/** git でないフォルダの保管庫（名前 `folder`） */
let folder: string;
/** main 以外をチェックアウトしている git の保管庫（名前 `other`） */
let other: string;

let createSaveMemoryTool: (vault: VaultRoot) => Tool;
let findKnowledgeVault: (name: string) => VaultRoot | undefined;
let getMemoryVault: () => VaultRoot | undefined;
let searchKnowledge: (query: string) => Promise<{ documentName: string }[]>;
let POST_CHAT: (request: NextRequest) => Promise<Response>;
let POST_APPROVAL: (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => Promise<Response>;
let GET_TOOLS: () => Promise<Response>;

/**
 * git を実行して標準出力を返す（テストの準備・確認）。
 *
 * @param cwd - リポジトリ
 * @param args - git の引数
 * @returns 標準出力（前後の空白を除く）
 */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/**
 * テスト用の git のリポジトリを作る。作者・署名はリポジトリの設定で決め、手元の git の設定に左右されないようにする
 * （ツールの git は `buildCommandEnv` で `HOME` を引き継ぐため、手元の `~/.gitconfig` も読む）。
 *
 * @param dir - リポジトリのフォルダ
 */
async function initRepo(dir: string) {
  await mkdir(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'test');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'commit.gpgsign', 'false');
  // 手元の core.hooksPath（共通のフック）に左右されないよう、リポジトリの中のフックだけを使う
  git(dir, 'config', 'core.hooksPath', '.git/hooks');
  await writeFile(path.join(dir, 'README.md'), '# メモ\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
}

/** `/api/embed` に送られた入力（呼ばれた順） */
let embedInputs: string[][] = [];

/**
 * Ollama をスタブにする。`/api/embed` は埋め込みを返し、チャットは `chat` に任せる。
 *
 * @param options - `embedFails` で埋め込みを Ollama に繋がらない例外にする。`chat` はチャットの応答
 */
function stubOllama(
  options: { embedFails?: boolean; chat?: () => Response } = {}
) {
  embedInputs = [];
  stubFetch(async (url, init) => {
    if (url.endsWith('/api/embed')) {
      if (options.embedFails) throw new TypeError('fetch failed');
      // ボディは embed()（lib/llm/ollama.ts）が JSON.stringify した { model, input } で、形はアプリが決めている
      const { input } = JSON.parse(String(init?.body)) as { input: string[] };
      embedInputs.push(input);
      return Response.json({ embeddings: input.map(() => VECTOR) });
    }
    if (options.chat) return options.chat();
    throw new Error(`unexpected ${url}`);
  });
}

/**
 * ツールの準備をする（承認で見せる内容の確認用）。
 *
 * @param vaultName - 保管庫の名前
 * @param args - ツールの引数
 * @returns 準備の結果
 */
async function prepare(vaultName: string, args: Record<string, unknown>) {
  const vault = findKnowledgeVault(vaultName);
  expect(vault).toBeDefined();
  // 上の expect で保管庫があることを確かめた
  const tool = createSaveMemoryTool(vault!);
  // save_memory は承認が要るツールで、prepare を必ず持つ
  return tool.prepare!(args, new AbortController().signal);
}

/**
 * ツールを準備して、そのまま許可したものとして実行する。
 *
 * @param vaultName - 保管庫の名前
 * @param args - ツールの引数
 * @returns 承認で見せた内容と、実行の結果
 */
async function saveApproved(vaultName: string, args: Record<string, unknown>) {
  const prepared = await prepare(vaultName, args);
  if (!prepared.ok) throw new Error(`準備に失敗: ${prepared.output.result}`);
  const output = await prepared.run(new AbortController().signal);
  // save_memory の準備は MemoryApprovalPreview を返す
  return { preview: prepared.preview as MemoryApprovalPreview, output };
}

/**
 * メモの保管庫のファイルを読む。
 *
 * @param root - 保管庫
 * @param name - メモの名前
 * @returns 中身
 */
function readMemory(root: string, name: string) {
  return readFile(path.join(root, 'memories', `${name}.md`), 'utf8');
}

beforeAll(async () => {
  workspace = realpathSync(
    await mkdtemp(path.join(tmpdir(), 'knowledge-memory-'))
  );
  memory = path.join(workspace, 'memory');
  folder = path.join(workspace, 'folder');
  other = path.join(workspace, 'other');
  await initRepo(memory);
  await mkdir(folder);
  await initRepo(other);
  git(other, 'checkout', '-q', '-b', 'feature');

  // 保管庫の設定・ツールの登録は、初めて使うときに 1 度だけ読むため、設定してから読み込む（ファイルごとにモジュールは隔離される）
  vi.stubEnv('KNOWLEDGE_VAULTS', [memory, folder, other].join(','));
  vi.stubEnv('KNOWLEDGE_MEMORY_VAULT', 'memory');
  // 開発者のシェルの設定でツールが増えても結果が変わらないよう、ほかのツールの設定を空にする
  vi.stubEnv('LOCAL_FILE_ROOTS', '');
  vi.stubEnv('LOCAL_FILE_WRITE_ROOTS', '');
  vi.stubEnv('LOCAL_COMMANDS', '');
  ({ createSaveMemoryTool } =
    await import('@/lib/agent/tools/memory/save-memory'));
  ({ findKnowledgeVault, getMemoryVault } =
    await import('@/lib/server/knowledge-vault-config'));
  ({ searchKnowledge } = await import('@/lib/server/knowledge'));
  ({ POST: POST_CHAT } = await import('@/app/api/chat/route'));
  ({ POST: POST_APPROVAL } =
    await import('@/app/api/agent/approvals/[id]/route'));
  ({ GET: GET_TOOLS } = await import('@/app/api/tools/route'));
});

beforeEach(async () => {
  await resetDb();
  stubOllama();
  // 前のテストのメモを消し、main を最初のコミットに戻す
  for (const root of [memory, other]) {
    await rm(path.join(root, 'memories'), { recursive: true, force: true });
    git(root, 'reset', '-q', '--hard');
    git(root, 'clean', '-qfd');
  }
  git(
    memory,
    'reset',
    '-q',
    '--hard',
    git(memory, 'rev-list', '--max-parents=0', 'HEAD')
  );
  await rm(path.join(folder, 'memories'), { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(workspace, { recursive: true, force: true });
  await resetDb();
  await prisma.$disconnect();
});

describe('save_memory（メモの保管庫への書き込み）', () => {
  describe('正常系', () => {
    it('新しいメモを書き、main にこのファイルだけをコミットし、索引に入れて検索に当たる', async () => {
      // 利用者がほかの変更をステージしていても、コミットには入れない
      await writeFile(path.join(memory, 'README.md'), '# メモ（書きかけ）\n');
      git(memory, 'add', 'README.md');

      const { preview, output } = await saveApproved('memory', ARGS);

      expect(preview).toMatchObject({
        action: 'save-memory',
        mode: 'create',
        vault: 'memory',
        path: 'memories/coffee-preference.md',
        branch: 'main',
        removed: 0,
      });
      expect(preview.diff).toContain('+name: coffee-preference');
      expect(output.isError).toBe(false);
      expect(output.result).toMatch(
        /^memory\/memories\/coffee-preference\.md を作成しました。コミットしました（[0-9a-f]{7,}）。索引に入れました/
      );
      expect(output.summary).toBe('coffee-preference.md を作成');

      const today = formatMemoryDate(new Date());
      expect(await readMemory(memory, 'coffee-preference')).toBe(
        [
          '---',
          'name: coffee-preference',
          'description: "朝はブラックのコーヒーを飲む"',
          'type: preference',
          `created: ${today}`,
          `updated: ${today}`,
          '---',
          '',
          ARGS.content,
          '',
        ].join('\n')
      );
      expect(git(memory, 'log', '-1', '--format=%s')).toBe(
        'memory: coffee-preference を保存'
      );
      expect(git(memory, 'show', '--name-only', '--format=', 'HEAD')).toBe(
        'memories/coffee-preference.md'
      );
      // ステージしていた README.md はステージされたまま残る
      expect(git(memory, 'diff', '--cached', '--name-only')).toBe('README.md');

      const document = await prisma.knowledgeDocument.findUnique({
        where: { name: 'memory/memories/coffee-preference.md' },
        select: { vault: true, sourceHash: true },
      });
      expect(document).toEqual({
        vault: 'memory',
        sourceHash: git(
          memory,
          'rev-parse',
          'HEAD:memories/coffee-preference.md'
        ),
      });
      const hits = await searchKnowledge('コーヒーの好み');
      expect(hits.map((hit) => hit.documentName)).toContain(
        'memory/memories/coffee-preference.md'
      );
    });

    it('同じ名前のメモは差分を見せて上書きし、作った日を保って変えた日を今日にする', async () => {
      await mkdir(path.join(memory, 'memories'));
      await writeFile(
        path.join(memory, 'memories', 'coffee-preference.md'),
        [
          '---',
          'name: coffee-preference',
          'description: "コーヒーの好み"',
          'type: preference',
          'created: 2026-01-02',
          'updated: 2026-01-03',
          '---',
          '',
          'ミルクを入れる。',
          '',
        ].join('\n')
      );
      git(memory, 'add', '-A');
      git(memory, 'commit', '-q', '-m', '前のメモ');

      const { preview, output } = await saveApproved('memory', ARGS);

      expect(preview).toMatchObject({ mode: 'overwrite' });
      expect(preview.diff).toContain('-ミルクを入れる。');
      expect(preview.diff).toContain(`+${ARGS.content}`);
      expect(output.result).toContain('を更新しました');
      const text = await readMemory(memory, 'coffee-preference');
      expect(text).toContain('created: 2026-01-02');
      expect(text).toContain(`updated: ${formatMemoryDate(new Date())}`);
      expect(git(memory, 'log', '-1', '--format=%s')).toBe(
        'memory: coffee-preference を更新'
      );
    });

    it('git でないフォルダの保管庫は、書くだけでコミットせず、索引に入れる', async () => {
      const { preview, output } = await saveApproved('folder', ARGS);

      expect(preview.branch).toBeNull();
      expect(output.isError).toBe(false);
      expect(output.result).not.toContain('コミット');
      expect(await readMemory(folder, 'coffee-preference')).toContain(
        ARGS.content
      );
      expect(
        await prisma.knowledgeDocument.count({
          where: { name: 'folder/memories/coffee-preference.md' },
        })
      ).toBe(1);
    });

    it('/api/chat で許可されたら、書いてコミットし、承認の依頼にメモの内容を載せる', async () => {
      const { events } = await runChat(true);

      const request = events.find((e) => e.type === 'tool_approval_request');
      expect(request).toMatchObject({
        name: 'save_memory',
        preview: {
          action: 'save-memory',
          path: 'memories/coffee-preference.md',
          branch: 'main',
        },
      });
      expect(memoryResult(events)).toMatchObject({
        isError: false,
        approval: 'approved',
      });
      expect(git(memory, 'log', '-1', '--format=%s')).toBe(
        'memory: coffee-preference を保存'
      );
    });

    it('KNOWLEDGE_MEMORY_VAULT の保管庫があれば save_memory を登録し、ツールの一覧に出す', async () => {
      expect(getMemoryVault()).toMatchObject({ name: 'memory', root: memory });
      const res = await GET_TOOLS();
      const { tools }: { tools: { name: string }[] } = await res.json();
      expect(tools.map((tool) => tool.name)).toContain('save_memory');
    });
  });

  describe('準正常系', () => {
    it('同じ内容のメモがあれば、承認を求めずに書く必要が無いと返す', async () => {
      await saveApproved('memory', ARGS);
      const head = git(memory, 'rev-parse', 'HEAD');

      const prepared = await prepare('memory', ARGS);

      expect(prepared.ok).toBe(false);
      expect(!prepared.ok && prepared.output.result).toContain(
        '同じ内容のメモがすでにあります'
      );
      expect(git(memory, 'rev-parse', 'HEAD')).toBe(head);
    });

    it('main 以外をチェックアウトしている保管庫には書かない', async () => {
      const prepared = await prepare('other', ARGS);

      expect(prepared.ok).toBe(false);
      expect(!prepared.ok && prepared.output.result).toContain(
        'feature をチェックアウトしています。main に切り替えてから'
      );
      await expect(readMemory(other, 'coffee-preference')).rejects.toThrow();
    });

    it('承認を待つ間にメモが書き換えられたら書かない', async () => {
      await saveApproved('memory', ARGS);
      const prepared = await prepare('memory', {
        ...ARGS,
        content: '新しい内容',
      });
      if (!prepared.ok) throw new Error('準備に失敗');
      await writeFile(
        path.join(memory, 'memories', 'coffee-preference.md'),
        '手で書き換えた\n'
      );

      const output = await prepared.run(new AbortController().signal);

      expect(output.isError).toBe(true);
      expect(output.result).toContain(
        '承認を待つ間に変わったため書きませんでした'
      );
      expect(await readMemory(memory, 'coffee-preference')).toBe(
        '手で書き換えた\n'
      );
    });

    it('新しいメモの承認を待つ間に同じ名前のファイルができたら書かない', async () => {
      const prepared = await prepare('memory', ARGS);
      if (!prepared.ok) throw new Error('準備に失敗');
      await mkdir(path.join(memory, 'memories'));
      await writeFile(
        path.join(memory, 'memories', 'coffee-preference.md'),
        '先にできた\n'
      );

      const output = await prepared.run(new AbortController().signal);

      expect(output.isError).toBe(true);
      expect(await readMemory(memory, 'coffee-preference')).toBe(
        '先にできた\n'
      );
    });

    it.each([
      ['名前が規則に合わない', { name: 'Coffee' }, 'は使えません'],
      [
        '本文に鍵らしい文字列がある',
        { content: 'キーは AKIAABCDEFGHIJKLMNOP' },
        'AWS のアクセスキーらしい文字列',
      ],
    ])('%s引数は、承認を求めずに理由を返す', async (_label, patch, message) => {
      const prepared = await prepare('memory', { ...ARGS, ...patch });

      expect(prepared.ok).toBe(false);
      expect(!prepared.ok && prepared.output.result).toContain(message);
    });

    it('/api/chat で拒否されたら書かない', async () => {
      const { events } = await runChat(false);

      expect(memoryResult(events)).toMatchObject({
        isError: true,
        approval: 'rejected',
      });
      await expect(readMemory(memory, 'coffee-preference')).rejects.toThrow();
    });
  });

  describe('異常系', () => {
    it('埋め込みを作れなくても、書いてコミットしたまま、索引に入れられなかったと返す', async () => {
      stubOllama({ embedFails: true });

      const { output } = await saveApproved('memory', ARGS);

      expect(output.isError).toBe(false);
      expect(output.result).toContain('コミットしました');
      expect(output.result).toContain(
        '索引に入れられませんでした。Ollama が起動しているかを確かめてください（ドキュメントのダイアログの「同期」で入れられます）'
      );
      expect(git(memory, 'log', '-1', '--format=%s')).toBe(
        'memory: coffee-preference を保存'
      );
      expect(await prisma.knowledgeDocument.count()).toBe(0);
    });

    it('コミットに失敗したら、書いたファイルを残し、失敗として返して索引に入れない', async () => {
      const hook = path.join(memory, '.git', 'hooks', 'pre-commit');
      await writeFile(hook, '#!/bin/sh\necho "hook で止めた" >&2\nexit 1\n');
      await chmod(hook, 0o755);
      try {
        const { output } = await saveApproved('memory', ARGS);

        expect(output.isError).toBe(true);
        expect(output.result).toContain(
          'ただし、コミットできませんでした（hook で止めた）。ファイルは書いたまま残っています'
        );
        expect(output.result).toContain(
          'コミットしていないため、索引に入れていません'
        );
        expect(output.summary).toBe(
          'coffee-preference.md を作成（コミットに失敗）'
        );
        expect(await readMemory(memory, 'coffee-preference')).toContain(
          ARGS.content
        );
        expect(git(memory, 'log', '-1', '--format=%s')).toBe('init');
        expect(embedInputs).toEqual([]);
      } finally {
        await rm(hook);
      }
    });

    it('memories が保管庫の外を指すシンボリックリンクなら書かない', async () => {
      const outside = path.join(workspace, 'outside');
      await mkdir(outside, { recursive: true });
      await symlink(outside, path.join(memory, 'memories'));

      const prepared = await prepare('memory', ARGS);

      expect(prepared.ok).toBe(false);
      expect(!prepared.ok && prepared.output.result).toContain(
        'memories がフォルダではない（シンボリックリンク等）ため書きません'
      );
    });

    it('KNOWLEDGE_MEMORY_VAULT が保管庫に無い名前なら、メモの保管庫は無い', () => {
      vi.stubEnv('KNOWLEDGE_MEMORY_VAULT', 'unknown');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        expect(getMemoryVault()).toBeUndefined();
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('KNOWLEDGE_MEMORY_VAULT の "unknown"')
        );
      } finally {
        warn.mockRestore();
        vi.stubEnv('KNOWLEDGE_MEMORY_VAULT', 'memory');
      }
    });
  });
});

/**
 * `/api/chat` で save_memory を呼ばせ、承認の依頼に `approved` で答える。
 *
 * Ollama は 1 回目に save_memory を呼び、2 回目以降は「覚えました」と答える。
 *
 * @param approved - 許可するか
 * @returns 受け取ったイベント（受信順）
 */
async function runChat(approved: boolean) {
  let calls = 0;
  stubOllama({
    chat: () => {
      if (calls++ > 0) {
        return new Response(
          JSON.stringify({
            model: 'test',
            message: { role: 'assistant', content: '覚えました' },
            done: true,
          }) + '\n',
          { headers: { 'content-type': 'application/x-ndjson' } }
        );
      }
      return new Response(
        JSON.stringify({
          model: 'test',
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              { function: { name: 'save_memory', arguments: ARGS } },
            ],
          },
          done: true,
        }) + '\n',
        { headers: { 'content-type': 'application/x-ndjson' } }
      );
    },
  });
  const res = await POST_CHAT(
    jsonRequest(CHAT_URL, 'POST', {
      message: 'コーヒーはブラックが好きだと覚えておいて',
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
  return { events };
}

/**
 * イベント列から save_memory の実行結果を取り出す。
 *
 * @param events - イベント列
 * @returns save_memory の tool_call_result
 */
function memoryResult(events: AgentStreamEvent[]) {
  return events.find(
    (event): event is Extract<AgentStreamEvent, { type: 'tool_call_result' }> =>
      event.type === 'tool_call_result' && event.name === 'save_memory'
  );
}
