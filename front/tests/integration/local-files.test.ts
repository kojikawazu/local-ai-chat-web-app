import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import type { Tool } from '@/lib/agent/tools/types';
import { resolveRoots } from '@/lib/agent/tools/local-files/config';
import { createListDirectoryTool } from '@/lib/agent/tools/local-files/list-directory';
import { createSearchFilesTool } from '@/lib/agent/tools/local-files/search-files';
import { createReadFileTool } from '@/lib/agent/tools/local-files/read-file';

/**
 * ローカルのファイルのツール（#148）の IT。
 * 一時フォルダに実際のファイル・シンボリックリンクを作り、3 つのツールを実行する。
 * fs は実際の依存のため本物を使う（モックするとモックの動きを確かめるだけになる）。DB と Ollama は使わない。
 * 許可するフォルダの外へ出られないこと（`..`・シンボリックリンク）と、秘匿ファイルを読めないことが主な契約。
 */

/** テスト用の一時フォルダ（許可するフォルダとその外を並べて作る） */
let base: string;
/** 許可するフォルダ（実体のパス。macOS の /var は /private/var のリンクのため realpath した値） */
let root: string;
/** 許可するフォルダの外 */
let outside: string;
let listDirectory: Tool;
let searchFiles: Tool;
let readFile: Tool;

/** ツールの実行に渡す、中断されない signal */
const signal = new AbortController().signal;

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'local-files-it-'));
  [root] = resolveRoots([await mkdtemp(path.join(base, 'root-'))]);
  outside = path.join(base, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'secret.txt'), '外のファイル');

  await writeFile(path.join(root, 'README.md'), '# サンプル\n\nhello world\n');
  await mkdir(path.join(root, 'src'));
  await writeFile(
    path.join(root, 'src', 'index.ts'),
    "export const greeting = 'Hello World';\n"
  );
  await writeFile(path.join(root, 'src', 'util.ts'), 'export {};\n');
  await writeFile(path.join(root, '.env'), 'API_TOKEN=dummy-value\n');
  await writeFile(path.join(root, '.env.example'), 'API_TOKEN=\n');
  await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  await writeFile(
    path.join(root, 'node_modules', 'pkg', 'index.js'),
    'hello world\n'
  );
  await mkdir(path.join(root, '.ssh'));
  await writeFile(path.join(root, '.ssh', 'config'), 'Host *\n');
  await writeFile(
    path.join(root, 'long.txt'),
    Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join('\n')
  );
  await writeFile(
    path.join(root, 'image.bin'),
    Buffer.from([0x89, 0x00, 0x01])
  );
  await symlink(outside, path.join(root, 'to-outside'));
  await symlink(path.join(root, '.env'), path.join(root, 'innocent.txt'));

  listDirectory = createListDirectoryTool([root]);
  searchFiles = createSearchFilesTool([root]);
  readFile = createReadFileTool([root]);
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('list_directory', () => {
  describe('正常系', () => {
    it('直下をフォルダ・ファイル・リンクの順に出し、秘匿ファイルと生成物のフォルダは出さない', async () => {
      const output = await listDirectory.execute({ path: root }, signal);

      expect(output.isError).toBe(false);
      expect(output.result).toContain('[フォルダ] src/');
      expect(output.result).toContain('[ファイル] README.md（');
      expect(output.result).toContain('[ファイル] .env.example');
      expect(output.result).toContain('[リンク] to-outside');
      expect(output.result).not.toMatch(/\.env（|node_modules|\.ssh/);
      expect(output.result).toContain('3 件は出していません');
    });
  });

  describe('準正常系', () => {
    it('ファイルを指定したらフォルダではないと返す', async () => {
      const output = await listDirectory.execute(
        { path: path.join(root, 'README.md') },
        signal
      );
      expect(output.isError).toBe(true);
    });
  });

  describe('異常系', () => {
    it('許可したフォルダの外は、使えるフォルダを添えて断る', async () => {
      const output = await listDirectory.execute({ path: outside }, signal);
      expect(output.isError).toBe(true);
      expect(output.result).toContain('読んでよいフォルダの外です');
      expect(output.result).toContain(root);
    });
  });
});

describe('search_files', () => {
  describe('正常系', () => {
    it('ファイル名をワイルドカードで探し、たどらないフォルダ・秘匿ファイルは探さない', async () => {
      const output = await searchFiles.execute(
        { query: '*.ts', path: root },
        signal
      );
      expect(output.summary).toBe('2 件');
      expect(output.result).toContain(path.join(root, 'src', 'index.ts'));
      expect(output.result).toContain(path.join(root, 'src', 'util.ts'));
    });

    it('中身を大文字・小文字を区別せずに探し、行番号付きで返す', async () => {
      const output = await searchFiles.execute(
        { query: 'hello world', path: root, target: 'content' },
        signal
      );
      expect(output.summary).toBe('2 件');
      expect(output.result).toContain(
        `${path.join(root, 'README.md')}:3: hello world`
      );
      expect(output.result).toContain(
        `${path.join(root, 'src', 'index.ts')}:1: export const greeting = 'Hello World';`
      );
      // node_modules の中・シンボリックリンクの先は探さない
      expect(output.result).not.toContain('node_modules');
    });
  });

  describe('準正常系', () => {
    it('見つからなければ 0 件（isEmpty）', async () => {
      const output = await searchFiles.execute(
        { query: 'no-such-name', path: root },
        signal
      );
      expect(output).toMatchObject({
        isError: false,
        isEmpty: true,
        summary: '0 件',
      });
    });

    it('秘匿ファイルの中身は探さない', async () => {
      const output = await searchFiles.execute(
        { query: 'API_TOKEN', path: root, target: 'content' },
        signal
      );
      // .env.example の行だけが見つかり、.env・リンク（innocent.txt → .env）は出ない
      expect(output.summary).toBe('1 件');
      expect(output.result).toContain('.env.example:1');
      expect(output.result).not.toContain('dummy-value');
    });
  });

  describe('異常系', () => {
    it('検索語が無い・target が不正・シンボリックリンクで外のフォルダを指したら断る', async () => {
      expect(
        (await searchFiles.execute({ query: ' ', path: root }, signal)).isError
      ).toBe(true);
      expect(
        (
          await searchFiles.execute(
            { query: 'x', path: root, target: 'regex' },
            signal
          )
        ).isError
      ).toBe(true);
      const viaLink = await searchFiles.execute(
        { query: 'secret', path: path.join(root, 'to-outside') },
        signal
      );
      expect(viaLink.isError).toBe(true);
      expect(viaLink.result).toContain('読んでよいフォルダの外です');
    });
  });
});

describe('read_file', () => {
  describe('正常系', () => {
    it('行番号付きで読み、範囲と全体の行数を要約に出す', async () => {
      const output = await readFile.execute(
        { path: path.join(root, 'README.md') },
        signal
      );
      expect(output.isError).toBe(false);
      expect(output.summary).toBe('README.md（1〜3 行目 / 全 3 行）');
      expect(output.result).toContain('1| # サンプル\n2| \n3| hello world');
    });

    it('start_line・end_line で範囲を読む（数の文字列も受け付ける）', async () => {
      const output = await readFile.execute(
        { path: path.join(root, 'long.txt'), start_line: '100', end_line: 102 },
        signal
      );
      expect(output.summary).toBe('long.txt（100〜102 行目 / 全 500 行）');
      expect(output.result).toContain(
        '100| line 100\n101| line 101\n102| line 102'
      );
    });
  });

  describe('準正常系', () => {
    it('上限の行数で切り、続きの読み方を書く', async () => {
      const output = await readFile.execute(
        { path: path.join(root, 'long.txt') },
        signal
      );
      expect(output.summary).toBe('long.txt（1〜300 行目 / 全 500 行）');
      expect(output.result).toContain('start_line に 301 を指定');
    });

    it('start_line が行数を超える・end_line が start_line より前なら理由を返す', async () => {
      const file = path.join(root, 'README.md');
      expect(
        (await readFile.execute({ path: file, start_line: 10 }, signal)).result
      ).toContain('ファイルの行数（3 行）を超えています');
      expect(
        (
          await readFile.execute(
            { path: file, start_line: 3, end_line: 2 },
            signal
          )
        ).isError
      ).toBe(true);
    });
  });

  describe('異常系', () => {
    it('秘匿ファイルは、名前でも・シンボリックリンク越しでも読めない', async () => {
      const direct = await readFile.execute(
        { path: path.join(root, '.env') },
        signal
      );
      expect(direct.isError).toBe(true);
      expect(direct.result).toContain('秘匿情報を含みうるため読めません');

      const viaLink = await readFile.execute(
        { path: path.join(root, 'innocent.txt') },
        signal
      );
      expect(viaLink.isError).toBe(true);
      expect(viaLink.result).not.toContain('dummy-value');

      const inSecretDir = await readFile.execute(
        { path: path.join(root, '.ssh', 'config') },
        signal
      );
      expect(inSecretDir.isError).toBe(true);
    });

    it('.. やシンボリックリンクで許可したフォルダの外へ出られない', async () => {
      for (const target of [
        path.join(root, '..', 'outside', 'secret.txt'),
        path.join(root, 'to-outside', 'secret.txt'),
      ]) {
        const output = await readFile.execute({ path: target }, signal);
        expect(output.isError, target).toBe(true);
        expect(output.result).not.toContain('外のファイル');
      }
    });

    it('相対パス・存在しないパス・バイナリ・フォルダは理由を返す', async () => {
      const cases: [Record<string, unknown>, string][] = [
        [{ path: 'README.md' }, '絶対パスで指定してください'],
        [{ path: path.join(root, 'none.txt') }, 'が見つかりません'],
        [{ path: path.join(root, 'image.bin') }, 'バイナリのため読めません'],
        [{ path: path.join(root, 'src') }, 'ファイルではありません'],
        [{}, 'path を指定してください'],
      ];
      for (const [args, reason] of cases) {
        const output = await readFile.execute(args, signal);
        expect(output.isError, reason).toBe(true);
        expect(output.result).toContain(reason);
      }
    });
  });
});
