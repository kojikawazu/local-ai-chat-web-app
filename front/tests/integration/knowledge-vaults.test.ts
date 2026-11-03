import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  onTestFinished,
  vi,
} from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { NextRequest } from 'next/server';
import type {
  KnowledgeVaultItem,
  VaultSyncPlanResponse,
} from '@/types/knowledge/vault';
import { getEmbeddingModel } from '@/lib/llm/ollama';
import { MAX_KNOWLEDGE_VAULT_FILES } from '@/lib/shared/validation';
import { prisma, resetDb, jsonRequest } from './helpers/db';
import { stubFetch } from './helpers/ollama-stub';

/**
 * RAG の保管庫（#235。`docs/28-rag.md`「保管庫の同期（Phase C）」）の IT。
 *
 * 一時フォルダに本物の git のリポジトリとふつうのフォルダを作って `KNOWLEDGE_VAULTS` に渡し、一覧 → 差分 → 1 ファイルずつの
 * 同期を実 PostgreSQL（pgvector）に通す。git の保管庫は既定のブランチ（main）のコミット済みの中身だけを読むこと（別の
 * ブランチ・作業ツリーの変更・コミットしていないファイルを読まないこと）を確かめる。Ollama の `/api/embed` だけをスタブにする。
 */
const BASE = 'http://localhost/api/knowledge/vaults';

/** スタブの埋め込み（どの文にも同じベクトルを返す。検索では、比べる範囲に入ったものが全部同じ近さになる） */
const VECTOR = [1, 0, 0, 0];

let workspace: string;
/** git のリポジトリの保管庫（名前 `notes`） */
let notes: string;
/** ふつうのフォルダの保管庫（名前 `memo`） */
let memo: string;
/** 既定のブランチを持たない git のリポジトリ（名前 `nobranch`） */
let nobranch: string;
/** ファイルが上限を超えるフォルダ（名前 `many`） */
let many: string;

let GET_VAULTS: () => Promise<Response>;
let PLAN: (
  request: NextRequest,
  context: { params: Promise<{ name: string }> }
) => Promise<Response>;
let SYNC: (
  request: NextRequest,
  context: { params: Promise<{ name: string }> }
) => Promise<Response>;
let DELETE_VAULT: (
  request: NextRequest,
  context: { params: Promise<{ name: string }> }
) => Promise<Response>;
let GET_DOCUMENTS: () => Promise<Response>;
let searchKnowledge: (query: string) => Promise<{ documentName: string }[]>;

/**
 * 保管庫の中で git を実行する（テストの準備。作者を決めて、手元の git の設定に左右されないようにする）。
 *
 * @param cwd - リポジトリ
 * @param args - git の引数
 */
function git(cwd: string, ...args: string[]) {
  execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args],
    { cwd, stdio: 'ignore' }
  );
}

/**
 * ファイルを書く（途中のフォルダも作る）。
 *
 * @param root - 保管庫
 * @param relativePath - 保管庫の中のパス
 * @param content - 中身
 */
async function put(
  root: string,
  relativePath: string,
  content: string | Buffer
) {
  const full = path.join(root, relativePath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content);
}

/** Ollama の `/api/embed` に送られた入力（呼ばれた順） */
let embedInputs: string[][] = [];

/**
 * `/api/embed` をスタブにする。
 *
 * @param fail - true なら Ollama に繋がらない例外にする
 */
function stubEmbed(fail = false) {
  embedInputs = [];
  stubFetch(async (url, init) => {
    if (!url.endsWith('/api/embed')) throw new Error(`unexpected ${url}`);
    if (fail) throw new TypeError('fetch failed');
    // ボディは embed()（lib/llm/ollama.ts）が JSON.stringify した { model, input } で、形はアプリが決めている
    const { input } = JSON.parse(String(init?.body)) as { input: string[] };
    embedInputs.push(input);
    return Response.json({ embeddings: input.map(() => VECTOR) });
  });
}

/**
 * 差分を求める。
 *
 * @param name - 保管庫の名前
 * @returns 応答
 */
function plan(name: string) {
  return PLAN(jsonRequest(`${BASE}/${name}/plan`, 'POST'), routeContext2(name));
}

/**
 * 1 ファイルを同期する。
 *
 * @param name - 保管庫の名前
 * @param body - ボディ（`{ path }`）
 * @returns 応答
 */
function sync(name: string, body: unknown) {
  return SYNC(
    jsonRequest(`${BASE}/${name}/sync`, 'POST', body),
    routeContext2(name)
  );
}

/**
 * `[name]` の route に渡すコンテキスト（`routeContext` は `id` の形のため、`name` の形を作る）。
 *
 * @param name - 保管庫の名前
 * @returns コンテキスト
 */
function routeContext2(name: string) {
  return { params: Promise.resolve({ name }) };
}

/**
 * 差分の足す・変わった・作り直し・消えたのパスを、全部同期する。
 *
 * @param name - 保管庫の名前
 * @param p - 差分
 * @returns パス → 結果
 */
async function syncAll(name: string, p: VaultSyncPlanResponse) {
  const results: Record<string, { status: string; error?: string }> = {};
  for (const target of [...p.add, ...p.update, ...p.rebuild, ...p.remove]) {
    const res = await sync(name, { path: target });
    expect(res.status).toBe(200);
    results[target] = await res.json();
  }
  return results;
}

/**
 * 保管庫の名前の付いたドキュメントを、名前の順に読む。
 *
 * @param vault - 保管庫の名前
 * @returns 名前・本文・版・モデル（名前の符号の順）
 */
async function documentsOf(vault: string) {
  const rows = await prisma.knowledgeDocument.findMany({
    where: { vault },
    select: {
      name: true,
      content: true,
      sourceHash: true,
      embeddingModel: true,
    },
  });
  // DB の ORDER BY は照合順序で並び、`dir/` と `dir2/` の順が環境で変わるため、符号の順で並べる
  return rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

beforeAll(async () => {
  workspace = realpathSync(
    await mkdtemp(path.join(tmpdir(), 'knowledge-vaults-'))
  );
  notes = path.join(workspace, 'notes');
  memo = path.join(workspace, 'memo');
  nobranch = path.join(workspace, 'nobranch');
  many = path.join(workspace, 'many');

  // notes: main に取り込むノートと取り込まないファイルを入れ、別のブランチ・作業ツリーの変更・書きかけを作る
  await mkdir(notes);
  git(notes, 'init', '-q', '-b', 'main');
  await put(notes, 'a.md', '# A\n\nアルファ（main）\n');
  await put(notes, 'dir/b.md', '# B\n\nブラボー\n');
  await put(notes, 'dir2/b.md', '# B2\n\n同じ名前の別のノート\n');
  await put(notes, 'memo.txt', 'テキストのメモ\n');
  await put(notes, '.claude/rules/x.md', '# ルール\n');
  await put(notes, 'CLAUDE.md', '# 設定\n');
  await put(notes, 'sub/AGENTS.md', '# 設定\n');
  await put(notes, 'image.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await put(notes, 'big.md', 'あ'.repeat(400_000));
  await put(notes, 'empty.md', '   \n');
  await put(notes, 'binary.txt', Buffer.from([0xff, 0xfe, 0x00, 0x41]));
  git(notes, 'add', '-A');
  git(notes, 'commit', '-q', '-m', 'init');
  git(notes, 'checkout', '-q', '-b', 'feature');
  await put(notes, 'feature-only.md', '# 別のブランチだけのノート\n');
  git(notes, 'add', '-A');
  git(notes, 'commit', '-q', '-m', 'feature');
  await put(notes, 'a.md', '# A\n\n作業ツリーで書き換えた\n');
  await put(notes, 'draft.md', '# 書きかけ\n');

  // memo: git でないフォルダ。生成物・隠しフォルダ・外を指すリンクを置く
  await mkdir(memo);
  await put(memo, 'x.md', '# X\n\nエックス\n');
  await put(memo, 'node_modules/pkg/README.md', '# 依存\n');
  await put(memo, '.hidden/z.md', '# 隠し\n');
  await put(workspace, 'outside.md', '# 保管庫の外\n');
  await symlink(path.join(workspace, 'outside.md'), path.join(memo, 'link.md'));

  // nobranch: main・master の無い git のリポジトリ
  await mkdir(nobranch);
  git(nobranch, 'init', '-q', '-b', 'dev');
  await put(nobranch, 'n.md', '# N\n');
  git(nobranch, 'add', '-A');
  git(nobranch, 'commit', '-q', '-m', 'dev');

  // many: ファイルの数が上限を 1 つ超えるフォルダ
  await mkdir(many);
  for (let i = 0; i <= MAX_KNOWLEDGE_VAULT_FILES; i++) {
    await put(many, `n${i}.md`, `# ${i}\n`);
  }

  // 保管庫の設定は、初めて使うときに 1 度だけ読むため、設定してから route を読み込む（ファイルごとにモジュールは隔離される）
  vi.stubEnv('KNOWLEDGE_VAULTS', [notes, memo, nobranch, many].join(','));
  ({ GET: GET_VAULTS } = await import('@/app/api/knowledge/vaults/route'));
  ({ POST: PLAN } =
    await import('@/app/api/knowledge/vaults/[name]/plan/route'));
  ({ POST: SYNC } =
    await import('@/app/api/knowledge/vaults/[name]/sync/route'));
  ({ DELETE: DELETE_VAULT } =
    await import('@/app/api/knowledge/vaults/[name]/route'));
  ({ GET: GET_DOCUMENTS } =
    await import('@/app/api/knowledge/documents/route'));
  ({ searchKnowledge } = await import('@/lib/server/knowledge'));
});

beforeEach(async () => {
  await resetDb();
  stubEmbed();
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

describe('保管庫の同期（/api/knowledge/vaults）', () => {
  describe('正常系', () => {
    it('一覧に設定の順で保管庫を出し、git は main とコミット・フォルダはフォルダと出す', async () => {
      const res = await GET_VAULTS();
      expect(res.status).toBe(200);
      const { vaults }: { vaults: KnowledgeVaultItem[] } = await res.json();
      expect(vaults.map((vault) => vault.name)).toEqual([
        'notes',
        'memo',
        'nobranch',
        'many',
      ]);
      expect(vaults[0]).toMatchObject({
        root: notes,
        configured: true,
        source: { kind: 'git', branch: 'main' },
        error: null,
        documentCount: 0,
        chunkCount: 0,
        lastUpdatedAt: null,
      });
      expect(vaults[0].source).toMatchObject({
        commit: expect.stringMatching(/^[0-9a-f]{7}$/),
      });
      expect(vaults[1]).toMatchObject({
        source: { kind: 'folder' },
        error: null,
      });
    });

    it('git の保管庫は main のコミット済みのノートだけを差分に出し、取り込まないものを理由ごとに数える', async () => {
      const res = await plan('notes');
      expect(res.status).toBe(200);
      const p: VaultSyncPlanResponse = await res.json();

      // 別のブランチだけのノート・書きかけ（draft.md）は出ない
      expect(p.add).toEqual([
        'a.md',
        'binary.txt',
        'dir/b.md',
        'dir2/b.md',
        'empty.md',
        'memo.txt',
      ]);
      expect(p).toMatchObject({
        update: [],
        rebuild: [],
        remove: [],
        unchanged: 0,
      });
      expect(p.source).toMatchObject({ kind: 'git', branch: 'main' });
      expect(
        Object.fromEntries(p.excluded.map((e) => [e.reason, e.count]))
      ).toEqual({
        hidden: 1,
        agent_config: 2,
        not_text: 1,
        too_large: 1,
      });
    });

    it('1 ファイルずつ同期すると、main の中身を「保管庫/パス」の名前で取り込み、同じ名前のノートも別に入る', async () => {
      const p: VaultSyncPlanResponse = await (await plan('notes')).json();

      const results = await syncAll('notes', p);

      expect(results['a.md']).toEqual({ status: 'imported' });
      expect(results['dir/b.md']).toEqual({ status: 'imported' });
      expect(results['dir2/b.md']).toEqual({ status: 'imported' });
      expect(results['memo.txt']).toEqual({ status: 'imported' });
      const documents = await documentsOf('notes');
      expect(documents.map((d) => d.name)).toEqual([
        'notes/a.md',
        'notes/dir/b.md',
        'notes/dir2/b.md',
        'notes/memo.txt',
      ]);
      // 作業ツリーで書き換えた中身ではなく、main のコミット済みの中身
      expect(documents[0].content).toBe('# A\n\nアルファ（main）\n');
      expect(documents[0].sourceHash).toMatch(/^[0-9a-f]{40}$/);
      // 画面から上げたドキュメントの一覧には出さない
      const { documents: uploaded } = await (await GET_DOCUMENTS()).json();
      expect(uploaded).toEqual([]);
    });

    it('同期した後は何もせず、main で変えた・消したファイルだけを取り込み直す・消す', async () => {
      await syncAll('notes', await (await plan('notes')).json());
      const before = await documentsOf('notes');

      let again: VaultSyncPlanResponse = await (await plan('notes')).json();
      expect(again).toMatchObject({
        update: [],
        rebuild: [],
        remove: [],
        unchanged: 4,
      });
      // 取り込めなかった（空・テキストでない）ファイルは、毎回足す候補に出る
      expect(again.add).toEqual(['binary.txt', 'empty.md']);

      // main で 1 つ変え、1 つ消す（作業ツリーの変更は退避して、ブランチを戻す）。後のテストのため、終わったら main を戻す
      const mainBefore = execFileSync('git', ['rev-parse', 'main'], {
        cwd: notes,
      })
        .toString()
        .trim();
      onTestFinished(() => git(notes, 'branch', '-f', 'main', mainBefore));
      git(notes, 'stash', '-u', '-q');
      git(notes, 'checkout', '-q', 'main');
      await put(notes, 'dir/b.md', '# B\n\nブラボー（書き換えた）\n');
      git(notes, 'rm', '-q', 'dir2/b.md');
      git(notes, 'commit', '-q', '-am', 'change');
      git(notes, 'checkout', '-q', 'feature');
      git(notes, 'stash', 'pop', '-q');

      again = await (await plan('notes')).json();
      expect(again).toMatchObject({
        update: ['dir/b.md'],
        remove: ['dir2/b.md'],
        unchanged: 2,
      });
      const results = await syncAll('notes', again);
      expect(results['dir/b.md']).toEqual({ status: 'imported' });
      expect(results['dir2/b.md']).toEqual({ status: 'removed' });

      const after = await documentsOf('notes');
      expect(after.map((d) => d.name)).toEqual([
        'notes/a.md',
        'notes/dir/b.md',
        'notes/memo.txt',
      ]);
      expect(after[1].content).toBe('# B\n\nブラボー（書き換えた）\n');
      // 変えていないファイルは取り込み直さない（版が同じ）
      expect(after[0].sourceHash).toBe(before[0].sourceHash);
    });

    it('埋め込みのモデルが違うファイルは作り直しに出し、同期で今のモデルにする', async () => {
      await syncAll('notes', await (await plan('notes')).json());
      await prisma.knowledgeDocument.update({
        where: { name: 'notes/a.md' },
        data: { embeddingModel: 'old-model' },
      });

      const p: VaultSyncPlanResponse = await (await plan('notes')).json();
      expect(p.rebuild).toEqual(['a.md']);
      expect((await syncAll('notes', p))['a.md']).toEqual({
        status: 'imported',
      });
      const [a] = await documentsOf('notes');
      expect(a.embeddingModel).toBe(getEmbeddingModel());
    });

    it('フォルダの保管庫は今の中身をたどり、生成物・隠しフォルダに入らず、リンクを取り込まない', async () => {
      const p: VaultSyncPlanResponse = await (await plan('memo')).json();
      expect(p.add).toEqual(['x.md']);
      expect(p.source).toEqual({ kind: 'folder' });
      expect(p.excluded).toEqual([{ reason: 'not_file', count: 1 }]);

      expect((await syncAll('memo', p))['x.md']).toEqual({
        status: 'imported',
      });
      const [x] = await documentsOf('memo');
      expect(x).toMatchObject({
        name: 'memo/x.md',
        content: '# X\n\nエックス\n',
      });
      expect(x.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('一覧に索引の数（ファイル・チャンク・作り直し・最後の更新）を出す', async () => {
      await syncAll('notes', await (await plan('notes')).json());
      const { vaults }: { vaults: KnowledgeVaultItem[] } = await (
        await GET_VAULTS()
      ).json();
      expect(vaults[0]).toMatchObject({
        documentCount: 4,
        chunkCount: 4,
        needsRebuildCount: 0,
        lastUpdatedAt: expect.any(String),
      });
    });
  });

  describe('準正常系', () => {
    it('保管庫に無いパス・取り込まないパスの同期は、読まずに removed を返す（何度呼んでも同じ）', async () => {
      for (const target of [
        'nothing.md',
        '.claude/rules/x.md',
        'CLAUDE.md',
        'image.png',
      ]) {
        const res = await sync('notes', { path: target });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ status: 'removed' });
      }
      expect(embedInputs).toEqual([]);
    });

    it('空・テキストでないファイルは rejected と理由を返し、索引に入れない', async () => {
      expect(await (await sync('notes', { path: 'empty.md' })).json()).toEqual({
        status: 'rejected',
        error: 'ファイルが空です',
      });
      expect(
        await (await sync('notes', { path: 'binary.txt' })).json()
      ).toEqual({
        status: 'rejected',
        error: 'UTF-8 のテキストのファイルではありません',
      });
      expect(await documentsOf('notes')).toEqual([]);
    });

    it('設定から外した保管庫は一覧に「設定に無い」と出し、検索に使わず、索引を消せる', async () => {
      await syncAll('notes', await (await plan('notes')).json());
      // 設定に無い保管庫の索引（以前の設定で取り込んだもの）を作る
      await prisma.knowledgeDocument.update({
        where: { name: 'notes/memo.txt' },
        data: { vault: 'gone', name: 'gone/memo.txt' },
      });

      const { vaults }: { vaults: KnowledgeVaultItem[] } = await (
        await GET_VAULTS()
      ).json();
      expect(vaults.at(-1)).toMatchObject({
        name: 'gone',
        root: null,
        configured: false,
        source: null,
        documentCount: 1,
      });

      const hits = await searchKnowledge('メモ');
      expect(hits.map((hit) => hit.documentName)).not.toContain(
        'gone/memo.txt'
      );
      expect(hits.map((hit) => hit.documentName)).toContain('notes/a.md');

      const res = await DELETE_VAULT(
        jsonRequest(`${BASE}/gone`, 'DELETE'),
        routeContext2('gone')
      );
      expect(res.status).toBe(200);
      expect(await documentsOf('gone')).toEqual([]);
    });

    it('設定にある保管庫の索引は消さない（409）・索引に無い保管庫は 404', async () => {
      const configured = await DELETE_VAULT(
        jsonRequest(`${BASE}/notes`, 'DELETE'),
        routeContext2('notes')
      );
      expect(configured.status).toBe(409);
      const missing = await DELETE_VAULT(
        jsonRequest(`${BASE}/unknown`, 'DELETE'),
        routeContext2('unknown')
      );
      expect(missing.status).toBe(404);
    });

    it('設定に無い保管庫の差分・同期は 404', async () => {
      expect((await plan('unknown')).status).toBe(404);
      expect((await sync('unknown', { path: 'a.md' })).status).toBe(404);
    });

    it('ファイルが上限を超える保管庫は、差分を出さずに 400', async () => {
      const res = await plan('many');
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(
        `保管庫のファイルは${MAX_KNOWLEDGE_VAULT_FILES.toLocaleString()}個まで取り込めます（${(MAX_KNOWLEDGE_VAULT_FILES + 1).toLocaleString()}個あります）`
      );
    });
  });

  describe('異常系', () => {
    it.each([
      ['親へ出るパス', '../outside.md'],
      ['途中の ..', 'dir/../../outside.md'],
      ['絶対パス', '/etc/passwd'],
      ['\\ の区切り', 'dir\\b.md'],
      ['空の区切り', 'dir//b.md'],
      ['NUL', 'a.md\u0000'],
      ['空', ''],
      ['文字列でない', 1],
    ])('同期のパスが%sなら 400 で、読まない', async (_label, target) => {
      const res = await sync('notes', { path: target });
      expect(res.status).toBe(400);
      expect(embedInputs).toEqual([]);
    });

    it.each([['..'], ['.'], ['a\\b']])(
      '保管庫の名前が「%s」なら 400',
      async (name) => {
        expect((await plan(name)).status).toBe(400);
      }
    );

    it('既定のブランチ（main・master）が無い git の保管庫は、一覧に理由を出し、差分は 500', async () => {
      const { vaults }: { vaults: KnowledgeVaultItem[] } = await (
        await GET_VAULTS()
      ).json();
      expect(vaults[2]).toMatchObject({
        name: 'nobranch',
        source: null,
        error: '既定のブランチ（main・master）が手元にありません',
      });
      const res = await plan('nobranch');
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe(
        '既定のブランチ（main・master）が手元にありません'
      );
    });

    it('埋め込みを作れなければ 502 で、索引に入れない', async () => {
      stubEmbed(true);
      const res = await sync('notes', { path: 'a.md' });
      expect(res.status).toBe(502);
      expect(await documentsOf('notes')).toEqual([]);
    });
  });
});
