import { describe, it, expect } from 'vitest';
import {
  assignVaultNames,
  isValidVaultName,
  normalizeVaultPath,
  planVaultSync,
  vaultDocumentName,
  vaultExclusionReason,
  vaultFileKind,
} from '@/lib/knowledge/vault';
import { decodeKnowledgeText } from '@/lib/knowledge/file';

/**
 * RAG の保管庫（#235）の純ロジック（`lib/knowledge/vault.ts`）の UT。
 *
 * パスの検証・取り込まない理由・名前の付け方・差分の計算を見る。fs・git・DB は IT（knowledge-vaults.test.ts）が担う。
 */

const MODEL = 'embeddinggemma:300m';

describe('normalizeVaultPath', () => {
  describe('正常系', () => {
    it.each([['a.md'], ['dir/sub/b.md'], ['日本語/メモ 1.txt']])(
      '保管庫の中の相対パス「%s」はそのまま受け付ける',
      (value) => {
        expect(normalizeVaultPath(value)).toEqual({ ok: true, path: value });
      }
    );
  });

  describe('準正常系', () => {
    it('500 文字ちょうどは受け付け、超えると断る', () => {
      expect(normalizeVaultPath('a'.repeat(497) + '.md').ok).toBe(true);
      expect(normalizeVaultPath('a'.repeat(498) + '.md').ok).toBe(false);
    });
  });

  describe('異常系', () => {
    it.each([
      ['親へ出る', '../a.md'],
      ['途中の ..', 'dir/../../a.md'],
      ['. の区切り', './a.md'],
      ['絶対パス', '/etc/passwd'],
      ['空の区切り', 'dir//a.md'],
      ['末尾の /', 'dir/'],
      ['\\ の区切り', 'dir\\a.md'],
      ['NUL', 'a.md\u0000'],
      ['改行', 'a\n.md'],
      ['空', ''],
    ])('%sのパスは断る', (_label, value) => {
      expect(normalizeVaultPath(value).ok).toBe(false);
    });

    it.each([[1], [null], [['a.md']]])(
      '文字列でない値（%j）は断る',
      (value) => {
        expect(normalizeVaultPath(value)).toEqual({
          ok: false,
          error: 'pathを指定してください',
        });
      }
    );
  });
});

describe('vaultExclusionReason・vaultFileKind', () => {
  describe('正常系', () => {
    it.each([['a.md'], ['dir/b.markdown'], ['memo/c.txt'], ['README.md']])(
      'ノート「%s」は取り込む',
      (value) => {
        expect(vaultExclusionReason(value)).toBeNull();
      }
    );

    it('種類は拡張子で決まる（.txt はテキスト、それ以外は Markdown）', () => {
      expect(vaultFileKind('dir/a.md')).toBe('markdown');
      expect(vaultFileKind('dir/a.TXT')).toBe('text');
      expect(vaultFileKind('dir/a.png')).toBeNull();
    });
  });

  describe('準正常系', () => {
    it.each([
      ['.claude/rules/x.md', 'hidden'],
      ['.github/PULL_REQUEST_TEMPLATE.md', 'hidden'],
      ['docs/.drafts/a.md', 'hidden'],
      ['.notes.md', 'hidden'],
      ['CLAUDE.md', 'agent_config'],
      ['sub/AGENTS.md', 'agent_config'],
      ['image.png', 'not_text'],
      ['data.json', 'not_text'],
    ])('「%s」は取り込まない（%s）', (value, reason) => {
      expect(vaultExclusionReason(value)).toBe(reason);
    });
  });

  describe('異常系', () => {
    it.each([
      ['.env', 'secret'],
      ['config/.env.local', 'secret'],
      ['id_rsa', 'secret'],
      ['keys/server.pem', 'secret'],
      ['.ssh/notes.md', 'hidden'],
    ])('秘匿ファイル「%s」は取り込まない（%s）', (value, reason) => {
      expect(vaultExclusionReason(value)).toBe(reason);
    });
  });
});

describe('isValidVaultName・assignVaultNames・vaultDocumentName', () => {
  describe('正常系', () => {
    it('名前はフォルダ名で、ドキュメントの名前は「保管庫/パス」', () => {
      expect(assignVaultNames(['/a/notes', '/b/memo'])).toEqual({
        vaults: [
          { name: 'notes', root: '/a/notes' },
          { name: 'memo', root: '/b/memo' },
        ],
        duplicates: [],
      });
      expect(vaultDocumentName('notes', 'dir/a.md')).toBe('notes/dir/a.md');
      expect(isValidVaultName('my-knowledge-notes')).toBe(true);
    });
  });

  describe('準正常系', () => {
    it('同じ名前のフォルダは、最初のものだけを使い、後のものを外す', () => {
      expect(assignVaultNames(['/a/notes', '/b/notes', '/c/memo'])).toEqual({
        vaults: [
          { name: 'notes', root: '/a/notes' },
          { name: 'memo', root: '/c/memo' },
        ],
        duplicates: ['/b/notes'],
      });
    });
  });

  describe('異常系', () => {
    it.each([[''], ['.'], ['..'], ['a/b'], ['a\\b'], ['a\u0000b']])(
      '保管庫の名前「%j」は受け付けない',
      (name) => {
        expect(isValidVaultName(name)).toBe(false);
      }
    );
  });
});

describe('planVaultSync', () => {
  describe('正常系', () => {
    it('索引に無いものは足し、版が違うものは取り込み直し、モデルだけ違うものは作り直し、無くなったものは消す', () => {
      const plan = planVaultSync(
        'notes',
        [
          { path: 'new.md', hash: 'h1' },
          { path: 'changed.md', hash: 'h2-new' },
          { path: 'old-model.md', hash: 'h3' },
          { path: 'same.md', hash: 'h4' },
        ],
        [
          { name: 'notes/changed.md', sourceHash: 'h2', embeddingModel: MODEL },
          {
            name: 'notes/old-model.md',
            sourceHash: 'h3',
            embeddingModel: 'old',
          },
          { name: 'notes/same.md', sourceHash: 'h4', embeddingModel: MODEL },
          { name: 'notes/gone.md', sourceHash: 'h5', embeddingModel: MODEL },
        ],
        MODEL
      );
      expect(plan).toEqual({
        add: ['new.md'],
        update: ['changed.md'],
        rebuild: ['old-model.md'],
        remove: ['gone.md'],
        unchanged: 1,
      });
    });
  });

  describe('準正常系', () => {
    it('一覧はパスの符号の順に並べる（画面の進み具合の順を決まったものにする）', () => {
      const plan = planVaultSync(
        'notes',
        [
          { path: 'dir2/b.md', hash: 'x' },
          { path: 'dir/b.md', hash: 'x' },
          { path: 'B.md', hash: 'x' },
          { path: 'a.md', hash: 'x' },
        ],
        [],
        MODEL
      );
      expect(plan.add).toEqual(['B.md', 'a.md', 'dir/b.md', 'dir2/b.md']);
    });

    it('版を持たない行（画面から上げた形の行）は、変わったものとして取り込み直す', () => {
      const plan = planVaultSync(
        'notes',
        [{ path: 'a.md', hash: 'x' }],
        [{ name: 'notes/a.md', sourceHash: null, embeddingModel: MODEL }],
        MODEL
      );
      expect(plan.update).toEqual(['a.md']);
    });
  });

  describe('異常系', () => {
    it('ほかの保管庫の名前の行は比べない（消さない）', () => {
      const plan = planVaultSync(
        'notes',
        [],
        [
          { name: 'notes-old/a.md', sourceHash: 'x', embeddingModel: MODEL },
          { name: 'other/a.md', sourceHash: 'x', embeddingModel: MODEL },
        ],
        MODEL
      );
      expect(plan).toEqual({
        add: [],
        update: [],
        rebuild: [],
        remove: [],
        unchanged: 0,
      });
    });
  });
});

describe('decodeKnowledgeText', () => {
  describe('正常系', () => {
    it('BOM を外し、改行をそろえ、バイト数を数える', () => {
      const bytes = new Uint8Array([
        0xef,
        0xbb,
        0xbf,
        ...new TextEncoder().encode('あ\r\nい\r'),
      ]);
      expect(decodeKnowledgeText(bytes)).toEqual({
        ok: true,
        value: { content: 'あ\nい\n', size: 8 },
      });
    });
  });

  describe('準正常系', () => {
    it('空白だけなら取り込まない', () => {
      expect(decodeKnowledgeText(new TextEncoder().encode(' \n\t'))).toEqual({
        ok: false,
        error: 'ファイルが空です',
      });
    });
  });

  describe('異常系', () => {
    it.each([
      ['UTF-8 でない', new Uint8Array([0xff, 0xfe, 0x41])],
      ['NUL を含む', new Uint8Array([0x41, 0x00, 0x42])],
    ])('%s中身は取り込まない', (_label, bytes) => {
      expect(decodeKnowledgeText(bytes)).toEqual({
        ok: false,
        error: 'UTF-8 のテキストのファイルではありません',
      });
    });

    it('1 MB を超えると取り込まない', () => {
      expect(decodeKnowledgeText(new Uint8Array(1024 * 1024 + 1)).ok).toBe(
        false
      );
    });
  });
});
