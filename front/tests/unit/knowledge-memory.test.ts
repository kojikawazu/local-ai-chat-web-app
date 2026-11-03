import { describe, it, expect } from 'vitest';
import {
  MAX_MEMORY_CONTENT_CHARS,
  MAX_MEMORY_DESCRIPTION_CHARS,
  buildMemoryFile,
  findSecretLike,
  formatMemoryDate,
  memoryNameError,
  memoryRelativePath,
  readMemoryDates,
  validateMemoryInput,
} from '@/lib/knowledge/memory';

/**
 * 会話から覚えさせるメモ（#236）の純ロジック（`lib/knowledge/memory.ts`）の UT。
 *
 * 引数の検証・frontmatter の組み立て・日付の読み取り・鍵らしい文字列の判定を見る。ファイル・git・索引は
 * IT（knowledge-memory.test.ts）が担う。
 */

/** 正しい引数（テストごとに一部だけ変える） */
const VALID = {
  name: 'coffee-preference',
  description: '朝はブラックのコーヒーを飲む',
  type: 'preference',
  content: '朝はブラックのコーヒーを飲む。\n砂糖・ミルクは入れない。',
};

describe('validateMemoryInput', () => {
  describe('正常系', () => {
    it('正しい引数はそのまま受け付ける', () => {
      expect(validateMemoryInput(VALID)).toEqual({ ok: true, value: VALID });
    });

    it('説明の前後の空白を除き、本文の改行を \\n にそろえて前後の空白行を除く', () => {
      const result = validateMemoryInput({
        ...VALID,
        description: '  説明  ',
        content: '\r\n\r\n1 行目\r\n2 行目\r3 行目\n\n',
      });
      expect(result).toEqual({
        ok: true,
        value: {
          ...VALID,
          description: '説明',
          content: '1 行目\n2 行目\n3 行目',
        },
      });
    });

    it.each([['user'], ['preference'], ['project'], ['reference'], ['fact']])(
      '種類「%s」を受け付ける',
      (type) => {
        expect(validateMemoryInput({ ...VALID, type }).ok).toBe(true);
      }
    );
  });

  describe('準正常系', () => {
    it('説明・本文の上限ちょうどは受け付け、超えると断る', () => {
      expect(
        validateMemoryInput({
          ...VALID,
          description: 'あ'.repeat(MAX_MEMORY_DESCRIPTION_CHARS),
          content: 'い'.repeat(MAX_MEMORY_CONTENT_CHARS),
        }).ok
      ).toBe(true);
      expect(
        validateMemoryInput({
          ...VALID,
          description: 'あ'.repeat(MAX_MEMORY_DESCRIPTION_CHARS + 1),
        }).ok
      ).toBe(false);
      expect(
        validateMemoryInput({
          ...VALID,
          content: 'い'.repeat(MAX_MEMORY_CONTENT_CHARS + 1),
        })
      ).toMatchObject({
        ok: false,
        error: expect.stringContaining('1 件に 1 つ'),
      });
    });

    it('知らない種類は、使える種類を挙げて断る', () => {
      expect(validateMemoryInput({ ...VALID, type: 'todo' })).toEqual({
        ok: false,
        error:
          'type は user / preference / project / reference / fact のどれかにしてください',
      });
    });

    it.each([
      ['空白だけの説明', { description: '   ' }],
      ['改行のある説明', { description: '1 行目\n2 行目' }],
      ['空白だけの本文', { content: ' \n ' }],
      ['制御文字のある本文', { content: 'a\u0007b' }],
    ])('%sは断る', (_label, patch) => {
      expect(validateMemoryInput({ ...VALID, ...patch }).ok).toBe(false);
    });
  });

  describe('異常系', () => {
    it.each([
      ['OpenAI の API キー', 'キーは sk-abcdefghijklmnopqrstuvwx です'],
      ['GitHub のトークン', `ghp_${'a'.repeat(36)}`],
      ['AWS のアクセスキー', 'AKIAABCDEFGHIJKLMNOP'],
      ['秘密鍵', '-----BEGIN OPENSSH PRIVATE KEY-----\nabc'],
    ])('本文に%sらしい文字列があれば保存しない', (label, content) => {
      expect(validateMemoryInput({ ...VALID, content })).toEqual({
        ok: false,
        error: `メモに${label}らしい文字列が含まれるため保存しません（git の履歴に残るため）。その部分を除いてください`,
      });
    });

    it('説明に鍵らしい文字列があっても保存しない', () => {
      expect(
        validateMemoryInput({
          ...VALID,
          description: 'キー AKIAABCDEFGHIJKLMNOP',
        }).ok
      ).toBe(false);
    });

    it.each([
      ['名前が無い', { name: undefined }],
      ['説明が文字列でない', { description: 1 }],
      ['種類が無い', { type: undefined }],
      ['本文が配列', { content: ['a'] }],
    ])('%s引数は断る', (_label, patch) => {
      expect(validateMemoryInput({ ...VALID, ...patch }).ok).toBe(false);
    });
  });
});

describe('memoryNameError・memoryRelativePath', () => {
  describe('正常系', () => {
    it.each([
      ['abc'],
      ['coffee-preference'],
      ['project-2026-q4'],
      ['a'.repeat(60)],
    ])('名前「%s」は使える', (name) => {
      expect(memoryNameError(name)).toBeNull();
    });

    it('パスは memories/<名前>.md', () => {
      expect(memoryRelativePath('coffee-preference')).toBe(
        'memories/coffee-preference.md'
      );
    });
  });

  describe('準正常系', () => {
    it.each([['ab'], ['a'.repeat(61)]])(
      '長さが外れる名前「%s」は使えない',
      (name) => {
        expect(memoryNameError(name)).toContain('は使えません');
      }
    );
  });

  describe('異常系', () => {
    it.each([
      ['Coffee'],
      ['coffee_preference'],
      ['-coffee'],
      ['coffee-'],
      ['coffee--preference'],
      ['../etc'],
      ['memo/x'],
      ['コーヒー'],
      ['coffee.md'],
    ])('パス・ファイル名に響く名前「%s」は使えない', (name) => {
      expect(memoryNameError(name)).not.toBeNull();
    });

    it('文字列でない名前は使えない', () => {
      expect(memoryNameError(42)).toContain(
        'name にメモの名前を指定してください'
      );
    });
  });
});

describe('buildMemoryFile・readMemoryDates・formatMemoryDate', () => {
  describe('正常系', () => {
    it('frontmatter と本文を組み立て、作った日・変えた日を読み戻せる', () => {
      const text = buildMemoryFile(
        { ...VALID, type: 'preference' },
        { created: '2026-11-01', updated: '2026-11-03' }
      );
      expect(text).toBe(
        [
          '---',
          'name: coffee-preference',
          'description: "朝はブラックのコーヒーを飲む"',
          'type: preference',
          'created: 2026-11-01',
          'updated: 2026-11-03',
          '---',
          '',
          '朝はブラックのコーヒーを飲む。',
          '砂糖・ミルクは入れない。',
          '',
        ].join('\n')
      );
      expect(readMemoryDates(text)).toEqual({
        created: '2026-11-01',
        updated: '2026-11-03',
      });
    });

    it('日付はその日の YYYY-MM-DD（月・日は 2 桁）', () => {
      expect(formatMemoryDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    });
  });

  describe('準正常系', () => {
    it('説明の引用符・コロン・# は JSON の文字列として書き、YAML が崩れない', () => {
      const text = buildMemoryFile(
        { ...VALID, type: 'fact', description: 'a: "b" # c \\ d' },
        { created: '2026-11-03', updated: '2026-11-03' }
      );
      expect(text).toContain('description: "a: \\"b\\" # c \\\\ d"');
    });

    it('本文の --- は frontmatter の日付の読み取りに響かない', () => {
      const text = buildMemoryFile(
        { ...VALID, type: 'fact', content: '---\ncreated: 1999-01-01\n---' },
        { created: '2026-11-01', updated: '2026-11-02' }
      );
      expect(readMemoryDates(text)).toEqual({
        created: '2026-11-01',
        updated: '2026-11-02',
      });
    });
  });

  describe('異常系', () => {
    it.each([
      ['frontmatter が無い', '# メモ\n\ncreated: 2026-11-01\n'],
      ['日付の形が崩れている', '---\ncreated: 11/1\nupdated: 昨日\n---\n'],
    ])('%sファイルの日付は null', (_label, text) => {
      expect(readMemoryDates(text)).toEqual({ created: null, updated: null });
    });
  });
});

describe('findSecretLike', () => {
  describe('正常系', () => {
    it('ふつうの文は鍵らしいと判定しない', () => {
      expect(
        findSecretLike('タスクは sk-1 と書いた。AKIA のような略語。ghp_ の話')
      ).toBeNull();
    });
  });

  describe('準正常系', () => {
    it('文の途中の鍵らしい文字列も見つける', () => {
      expect(findSecretLike('メモ: xoxb-1234567890-abcdef を使う')).toBe(
        'Slack のトークン'
      );
    });
  });

  describe('異常系', () => {
    it.each([
      [`AIza${'a'.repeat(35)}`, 'Google の API キー'],
      [`github_pat_${'a'.repeat(22)}`, 'GitHub のトークン'],
      ['-----BEGIN RSA PRIVATE KEY-----', '秘密鍵'],
    ])('「%s」は %s と判定する', (text, label) => {
      expect(findSecretLike(text)).toBe(label);
    });
  });
});
