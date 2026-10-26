import { describe, it, expect } from 'vitest';
import path from 'path';
import { parseRootList } from '@/lib/agent/tools/local-files/config';
import {
  findSecretSegment,
  isSecretDirName,
  isSecretFileName,
  isSkippedDirName,
  isWithinRoot,
} from '@/lib/agent/tools/local-files/path-guard';
import {
  formatBytes,
  isBinary,
  nameMatcher,
  sliceLines,
  splitLines,
  truncateLine,
} from '@/lib/agent/tools/local-files/text';
import { formatDirectoryListing } from '@/lib/agent/tools/local-files/list-directory';
import { formatSearchResult } from '@/lib/agent/tools/local-files/search-files';
import {
  formatFileSlice,
  parseLineArg,
} from '@/lib/agent/tools/local-files/read-file';
import { shouldBlockTool } from '@/lib/agent/agent';

/**
 * ローカルのファイルのツール（#148）の純関数の UT。
 * 許可するフォルダの解釈・パスの包含・秘匿ファイルの名前・行の切り出し・結果の文章・持ち出しの判定を確かめる。
 * fs に触れる流れ（realpath・シンボリックリンク・実際の検索）は IT（local-files.test.ts）で確かめる。
 * 純関数のため mock は使わない。
 */

const HOME = '/Users/someone';

describe('parseRootList', () => {
  describe('正常系', () => {
    it('カンマで区切り、~ をホームに置き換え、前後の空白を捨てる', () => {
      expect(parseRootList(' ~/developer/app , /tmp/notes,~ ', HOME)).toEqual({
        paths: [`${HOME}/developer/app`, '/tmp/notes', HOME],
        invalid: [],
      });
    });
  });

  describe('準正常系', () => {
    it('未設定・空・カンマだけなら何も無い', () => {
      expect(parseRootList(undefined, HOME)).toEqual({
        paths: [],
        invalid: [],
      });
      expect(parseRootList(' , ,', HOME)).toEqual({ paths: [], invalid: [] });
    });

    it('.. を含むパスは正規化する', () => {
      expect(parseRootList('/a/b/../c', HOME).paths).toEqual(['/a/c']);
    });
  });

  describe('異常系', () => {
    it('相対パス・~user の形は外して返す', () => {
      expect(parseRootList('src,./docs,~other/x,/ok', HOME)).toEqual({
        paths: ['/ok'],
        invalid: ['src', './docs', '~other/x'],
      });
    });
  });
});

describe('isWithinRoot', () => {
  describe('正常系', () => {
    it('フォルダの中と、フォルダそのものは中とみなす', () => {
      expect(isWithinRoot('/a/b/c.txt', '/a/b')).toBe(true);
      expect(isWithinRoot('/a/b', '/a/b')).toBe(true);
    });
  });

  describe('準正常系', () => {
    it('名前が .. で始まるだけのフォルダは中とみなす', () => {
      expect(isWithinRoot('/a/b/..hidden/x', '/a/b')).toBe(true);
    });
  });

  describe('異常系', () => {
    it('前方一致するだけの隣のフォルダ・親・別の場所は外とみなす', () => {
      expect(isWithinRoot('/a/bc/x', '/a/b')).toBe(false);
      expect(isWithinRoot('/a', '/a/b')).toBe(false);
      expect(isWithinRoot('/etc/passwd', '/a/b')).toBe(false);
    });
  });
});

describe('秘匿ファイル・フォルダの名前', () => {
  describe('正常系', () => {
    it('.env・鍵・認証情報のファイルは秘匿ファイル', () => {
      for (const name of [
        '.env',
        '.env.local',
        'server.key',
        'cert.pem',
        'id_rsa',
        'id_ed25519',
        'credentials.json',
        'serviceAccountKey.json',
      ]) {
        expect(isSecretFileName(name), name).toBe(true);
      }
    });

    it('鍵・認証情報のフォルダと、生成物のフォルダを見分ける', () => {
      expect(isSecretDirName('.ssh')).toBe(true);
      expect(isSecretDirName('.aws')).toBe(true);
      expect(isSkippedDirName('node_modules')).toBe(true);
      expect(isSkippedDirName('.git')).toBe(true);
      expect(isSkippedDirName('src')).toBe(false);
    });
  });

  describe('準正常系', () => {
    it('テンプレート・型定義・公開鍵は秘匿ファイルではない', () => {
      for (const name of [
        '.env.example',
        '.env.sample',
        'env.d.ts',
        '.env.d.ts',
        'id_rsa.pub',
        'keyboard.ts',
        'monkey',
      ]) {
        expect(isSecretFileName(name), name).toBe(false);
      }
    });
  });

  describe('異常系', () => {
    it('途中のフォルダ・最後のファイルの名前に秘匿のものがあれば、その名前を返す', () => {
      expect(findSecretSegment('/r/.ssh/config', '/r')).toBe('.ssh');
      expect(findSecretSegment('/r/app/.env', '/r')).toBe('.env');
      expect(findSecretSegment('/r/app/src/index.ts', '/r')).toBeNull();
      // フォルダの名前が .env でも、ファイルとしての判定は最後の名前だけに当てる
      expect(findSecretSegment('/r/.env.d/readme.md', '/r')).toBeNull();
    });
  });
});

describe('行の扱い', () => {
  describe('正常系', () => {
    it('行番号を付け、桁を揃えて切り出す', () => {
      const lines = Array.from({ length: 12 }, (_, i) => `line${i + 1}`);
      expect(
        sliceLines(lines, { start: 9, end: 10, maxLines: 300, maxChars: 1000 })
      ).toEqual({
        text: ' 9| line9\n10| line10',
        from: 9,
        to: 10,
        total: 12,
        truncated: false,
      });
    });

    it('改行は \\n・\\r\\n のどちらも分け、末尾の改行の後ろは数えない', () => {
      expect(splitLines('a\r\nb\nc\n')).toEqual(['a', 'b', 'c']);
      expect(splitLines('')).toEqual([]);
    });
  });

  describe('準正常系', () => {
    it('行数の上限で止め、切ったことを返す', () => {
      const lines = ['a', 'b', 'c', 'd'];
      const slice = sliceLines(lines, {
        start: 1,
        maxLines: 2,
        maxChars: 1000,
      });
      expect(slice.to).toBe(2);
      expect(slice.truncated).toBe(true);
    });

    it('文字数の上限に達した行の手前で止める', () => {
      const lines = ['x'.repeat(10), 'y'.repeat(10), 'z'.repeat(10)];
      const slice = sliceLines(lines, {
        start: 1,
        maxLines: 300,
        maxChars: 30,
      });
      expect(slice.text).toBe(`1| ${'x'.repeat(10)}\n2| ${'y'.repeat(10)}`);
      expect(slice.truncated).toBe(true);
    });

    it('1 行だけで文字数の上限を超えても、その行を切り詰めて返す', () => {
      const slice = sliceLines(['a'.repeat(100)], {
        start: 1,
        maxLines: 300,
        maxChars: 20,
      });
      expect(slice.text).toBe(`1| ${'a'.repeat(17)}…`);
      expect(slice.to).toBe(1);
    });

    it('長い 1 行は上限で切り詰めて … を付ける', () => {
      expect(truncateLine('abcdef', 3)).toBe('abc…');
      expect(truncateLine('abc', 3)).toBe('abc');
    });
  });

  describe('異常系', () => {
    it('先頭に NUL があればバイナリとみなす', () => {
      expect(isBinary(new Uint8Array([0x89, 0x50, 0x00, 0x47]))).toBe(true);
      expect(isBinary(new TextEncoder().encode('テキスト'))).toBe(false);
    });
  });
});

describe('nameMatcher', () => {
  describe('正常系', () => {
    it('ワイルドカードが無ければ、大文字・小文字を区別しない部分一致', () => {
      const match = nameMatcher('readme');
      expect(match('README.md')).toBe(true);
      expect(match('index.ts')).toBe(false);
    });

    it('* と ? は名前全体に当てる', () => {
      expect(nameMatcher('*.ts')('index.ts')).toBe(true);
      expect(nameMatcher('*.ts')('index.tsx')).toBe(false);
      expect(nameMatcher('v?.txt')('v1.txt')).toBe(true);
    });
  });

  describe('準正常系', () => {
    it('正規表現の記号は文字としてそのまま扱う', () => {
      expect(nameMatcher('a+b*')('a+b.txt')).toBe(true);
      expect(nameMatcher('a+b*')('aab.txt')).toBe(false);
      expect(nameMatcher('(x)')('file(x).md')).toBe(true);
    });
  });

  // 異常系: どんな文字列も式として組まないため、不正な検索語で例外になる経路が無い
});

describe('結果の文章', () => {
  describe('正常系', () => {
    it('一覧はフォルダ・ファイル・リンクを種類付きで出し、件数を要約にする', () => {
      const output = formatDirectoryListing(
        '/r',
        [
          { name: 'src', kind: 'dir' },
          { name: 'README.md', kind: 'file', size: 2048 },
          { name: 'latest', kind: 'link' },
        ],
        0,
        0
      );
      expect(output.result).toBe(
        '/r の中身（3 件）:\n[フォルダ] src/\n[ファイル] README.md（2.0KB）\n[リンク] latest'
      );
      expect(output.summary).toBe('3 件');
    });

    it('読んだ範囲と全体の行数を見出しと要約に出す', () => {
      const output = formatFileSlice(
        path.join('/r', 'README.md'),
        sliceLines(['a', 'b', 'c'], { start: 1, maxLines: 2, maxChars: 1000 })
      );
      expect(output.summary).toBe('README.md（1〜2 行目 / 全 3 行）');
      expect(output.result).toContain('続きは start_line に 3 を指定');
    });
  });

  describe('準正常系', () => {
    it('検索で上限に達したら「以上」を付け、0 件は isEmpty にする', () => {
      const many = formatSearchResult('x', 'name', '/r', {
        matches: Array.from({ length: 30 }, (_, i) => `/r/${i}`),
        limitReached: true,
        scanLimitReached: false,
        aborted: false,
      });
      expect(many.summary).toBe('30 件以上');

      const none = formatSearchResult('x', 'content', '/r', {
        matches: [],
        limitReached: false,
        scanLimitReached: false,
        aborted: true,
      });
      expect(none).toMatchObject({ isEmpty: true, summary: '0 件' });
      expect(none.result).toContain('時間の上限に達した');
    });

    it('出さなかった秘匿ファイル・生成物の件数を書く', () => {
      expect(formatDirectoryListing('/r', [], 2, 0).result).toBe(
        '/r は空です（2 件は出していません）'
      );
    });

    it('バイト数を単位付きにする', () => {
      expect(formatBytes(512)).toBe('512B');
      expect(formatBytes(1536)).toBe('1.5KB');
      expect(formatBytes(3 * 1024 * 1024)).toBe('3.0MB');
    });
  });

  // 異常系: 失敗は各ツールが toolError で返し、ここの関数には届かない（IT で確かめる）
});

describe('parseLineArg', () => {
  describe('正常系', () => {
    it('数と、整数の文字列を受け付ける', () => {
      expect(parseLineArg(10, 'start_line')).toEqual({ ok: true, value: 10 });
      expect(parseLineArg(' 7 ', 'start_line')).toEqual({ ok: true, value: 7 });
    });
  });

  describe('準正常系', () => {
    it('省略・null・空文字は指定なし', () => {
      expect(parseLineArg(undefined, 'x')).toEqual({
        ok: true,
        value: undefined,
      });
      expect(parseLineArg(null, 'x')).toEqual({ ok: true, value: undefined });
      expect(parseLineArg('', 'x')).toEqual({ ok: true, value: undefined });
    });
  });

  describe('異常系', () => {
    it('0・負数・小数・数でない文字列は理由を返す', () => {
      for (const value of [0, -1, 1.5, 'abc', '1e3', true]) {
        expect(parseLineArg(value, 'end_line')).toEqual({
          ok: false,
          reason: 'end_line は 1 以上の整数で指定してください',
        });
      }
    });
  });
});

describe('shouldBlockTool', () => {
  describe('正常系', () => {
    it('ローカルのファイルを読んだ後は、外部と通信するツールを止める', () => {
      expect(shouldBlockTool('network', true)).toBe(true);
    });
  });

  describe('準正常系', () => {
    it('読む前の外部のツール・読んだ後のローカルや計算のツールは止めない', () => {
      expect(shouldBlockTool('network', false)).toBe(false);
      expect(shouldBlockTool('local', true)).toBe(false);
      expect(shouldBlockTool(undefined, true)).toBe(false);
    });
  });

  // 異常系: 引数は型で決まった値だけで、不正な入力の経路が無い
});
