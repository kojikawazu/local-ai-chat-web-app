import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import type { PreparedAction, Tool } from '@/lib/agent/tools/types';
import { resolveRoots } from '@/lib/agent/tools/local-files/config';
import { createWriteFileTool } from '@/lib/agent/tools/local-files/write-file';
import { createEditFileTool } from '@/lib/agent/tools/local-files/edit-file';

/**
 * ファイルの書き込みのツール（#148 Phase A2）の IT。
 * 一時フォルダに実際のファイル・シンボリックリンクを作り、準備（prepare）→ 実行（run）を通す。
 * 承認そのもの（/api/chat のストリームと承認の API）は chat-agent-approval.test.ts が担う。DB と Ollama は使わない。
 */

let base: string;
/** 書き込みのフォルダ（実体のパス） */
let root: string;
/** 書き込みのフォルダの外 */
let outside: string;

const signal = new AbortController().signal;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'local-write-it-'));
  [root] = resolveRoots([await mkdtemp(path.join(base, 'root-'))]);
  outside = path.join(base, 'outside');
  await mkdir(outside);
  await writeFile(path.join(root, 'notes.md'), 'line 1\nline 2\nline 3\n');
  await writeFile(path.join(root, 'crlf.txt'), 'one\r\ntwo\r\n');
  await writeFile(path.join(root, 'dup.txt'), 'x\nx\n');
  await writeFile(path.join(root, '.env'), 'TOKEN=dummy\n');
  await mkdir(path.join(root, '.git', 'hooks'), { recursive: true });
  await writeFile(path.join(root, 'bin.dat'), Buffer.from([0, 1, 2]));
  await symlink(outside, path.join(root, 'to-outside'));
  await symlink(
    path.join(outside, 'missing.txt'),
    path.join(root, 'dangling.txt')
  );
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

/**
 * ツールの準備を呼ぶ（書き込みのツールは必ず prepare を持つ。持たなければテストの前提が崩れているため失敗させる）。
 *
 * @param tool - 書き込みのツール
 * @param args - ツールへ渡す引数
 * @returns 準備の結果
 */
async function prepare(
  tool: Tool,
  args: Record<string, unknown>
): Promise<PreparedAction> {
  if (!tool.prepare)
    throw new Error(`${tool.definition.name} は prepare を持ちません`);
  return tool.prepare(args, signal);
}

/**
 * 準備に成功したことを確かめ、型を絞る。
 *
 * @param prepared - 準備の結果
 * @returns 成功した準備
 */
function expectPrepared(prepared: PreparedAction) {
  if (!prepared.ok) {
    throw new Error(`準備に失敗しました: ${prepared.output.result}`);
  }
  return prepared;
}

describe('write_file', () => {
  const tool = () => createWriteFileTool([root]);

  describe('正常系', () => {
    it('新しいファイルを作る差分を見せ、許可されたら作る', async () => {
      const file = path.join(root, 'new.md');
      const prepared = expectPrepared(
        await prepare(tool(), { path: file, content: 'hello\n' })
      );
      expect(prepared.preview).toMatchObject({
        action: 'create',
        path: file,
        added: 1,
        removed: 0,
      });

      const output = await prepared.run(signal);
      expect(output).toMatchObject({
        isError: false,
        summary: 'new.md を作成（+1 −0）',
      });
      expect(await readFile(file, 'utf8')).toBe('hello\n');
    });

    it('既存のファイルは上書きの差分を見せ、許可されたら上書きする', async () => {
      const file = path.join(root, 'notes.md');
      const prepared = expectPrepared(
        await prepare(tool(), { path: file, content: 'line 1\nnew\n' })
      );
      expect(prepared.preview.action).toBe('overwrite');
      await prepared.run(signal);
      expect(await readFile(file, 'utf8')).toBe('line 1\nnew\n');
    });
  });

  describe('準正常系', () => {
    it('承認を待つ間にファイルが変わったら書かない', async () => {
      const file = path.join(root, 'notes.md');
      const prepared = expectPrepared(
        await prepare(tool(), { path: file, content: 'mine\n' })
      );
      await writeFile(file, '誰かが書き換えた\n');

      const output = await prepared.run(signal);
      expect(output.isError).toBe(true);
      expect(output.result).toContain('承認を待つ間に変わった');
      expect(await readFile(file, 'utf8')).toBe('誰かが書き換えた\n');
    });

    it('承認を待つ間に同じ名前のファイルができたら、新規作成で上書きしない', async () => {
      const file = path.join(root, 'race.md');
      const prepared = expectPrepared(
        await prepare(tool(), { path: file, content: 'mine\n' })
      );
      await writeFile(file, '先にできた\n');

      expect((await prepared.run(signal)).isError).toBe(true);
      expect(await readFile(file, 'utf8')).toBe('先にできた\n');
    });

    it('中身が今と同じなら、承認を求めずに理由を返す', async () => {
      const prepared = await prepare(tool(), {
        path: path.join(root, 'notes.md'),
        content: 'line 1\nline 2\nline 3\n',
      });
      expect(prepared.ok).toBe(false);
    });
  });

  describe('異常系', () => {
    it('秘匿ファイル・.git の中・外・シンボリックリンク越し・先の無いリンク・無い親・バイナリは準備で断る', async () => {
      const cases: [string, string][] = [
        [path.join(root, '.env'), '秘匿情報を含みうる'],
        [path.join(root, '.git', 'hooks', 'pre-commit'), '.git の中'],
        [path.join(outside, 'x.txt'), '書き込めるフォルダの外'],
        [path.join(root, 'to-outside', 'x.txt'), '書き込めるフォルダの外'],
        [path.join(root, 'dangling.txt'), '先の無いシンボリックリンク'],
        [path.join(root, 'no-dir', 'x.txt'), 'が見つかりません'],
        [path.join(root, 'bin.dat'), 'バイナリ'],
        ['relative.txt', '絶対パスで指定してください'],
      ];
      for (const [file, reason] of cases) {
        const prepared = await prepare(tool(), { path: file, content: 'x' });
        expect(prepared.ok, file).toBe(false);
        if (!prepared.ok) expect(prepared.output.result).toContain(reason);
      }
    });

    it('承認を経ずに execute を呼ばれても書かない', async () => {
      const file = path.join(root, 'direct.md');
      const output = await tool().execute({ path: file, content: 'x' }, signal);
      expect(output.isError).toBe(true);
      await expect(readFile(file, 'utf8')).rejects.toThrow();
    });
  });
});

describe('edit_file', () => {
  const tool = () => createEditFileTool([root]);

  describe('正常系', () => {
    it('1 か所だけ一致する文字列を置き換える差分を見せ、許可されたら書く', async () => {
      const file = path.join(root, 'notes.md');
      const prepared = expectPrepared(
        await prepare(tool(), {
          path: file,
          old_string: 'line 2',
          new_string: 'LINE 2',
        })
      );
      expect(prepared.preview).toMatchObject({
        action: 'edit',
        added: 1,
        removed: 1,
      });
      await prepared.run(signal);
      expect(await readFile(file, 'utf8')).toBe('line 1\nLINE 2\nline 3\n');
    });

    it('CRLF のファイルでも、\\n で渡された文字列で置き換え、CRLF を保つ', async () => {
      const file = path.join(root, 'crlf.txt');
      const prepared = expectPrepared(
        await prepare(tool(), {
          path: file,
          old_string: 'one\ntwo',
          new_string: '1\n2',
        })
      );
      await prepared.run(signal);
      expect(await readFile(file, 'utf8')).toBe('1\r\n2\r\n');
    });
  });

  describe('準正常系', () => {
    it('一致が 0 か所・2 か所以上なら、承認を求めずに理由を返す', async () => {
      const none = await prepare(tool(), {
        path: path.join(root, 'notes.md'),
        old_string: 'nothing',
        new_string: 'x',
      });
      expect(none.ok).toBe(false);
      const many = await prepare(tool(), {
        path: path.join(root, 'dup.txt'),
        old_string: 'x',
        new_string: 'y',
      });
      expect(many.ok).toBe(false);
      if (!many.ok) expect(many.output.result).toContain('2 か所');
    });

    it('承認を待つ間にファイルが変わったら書かない', async () => {
      const file = path.join(root, 'notes.md');
      const prepared = expectPrepared(
        await prepare(tool(), {
          path: file,
          old_string: 'line 3',
          new_string: 'end',
        })
      );
      await writeFile(file, 'line 1\nline 2\nline 3\nmore\n');
      expect((await prepared.run(signal)).isError).toBe(true);
      expect(await readFile(file, 'utf8')).toBe(
        'line 1\nline 2\nline 3\nmore\n'
      );
    });
  });

  describe('異常系', () => {
    it('無いファイル・秘匿ファイル・old_string が空なら断る', async () => {
      const cases: [Record<string, unknown>, string][] = [
        [
          {
            path: path.join(root, 'none.md'),
            old_string: 'a',
            new_string: 'b',
          },
          'write_file を使ってください',
        ],
        [
          {
            path: path.join(root, '.env'),
            old_string: 'TOKEN',
            new_string: 'X',
          },
          '秘匿情報を含みうる',
        ],
        [
          {
            path: path.join(root, 'notes.md'),
            old_string: '',
            new_string: 'b',
          },
          'old_string に置き換える前の文字列',
        ],
      ];
      for (const [args, reason] of cases) {
        const prepared = await prepare(tool(), args);
        expect(prepared.ok, reason).toBe(false);
        if (!prepared.ok) expect(prepared.output.result).toContain(reason);
      }
      expect(await readFile(path.join(root, '.env'), 'utf8')).toBe(
        'TOKEN=dummy\n'
      );
    });
  });
});
