import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { access, mkdir, mkdtemp, realpath, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import type { PreparedAction, Tool } from '@/lib/agent/tools/types';
import { resolveRoots } from '@/lib/agent/tools/local-files/config';
import { createRunCommandTool } from '@/lib/agent/tools/local-commands/run-command';
import { quoteArgv } from '@/lib/agent/tools/local-commands/parse';

/**
 * コマンドの実行のツール（#148 Phase B）の IT。
 * 一時フォルダを作業フォルダにして、実際に `node` を起動し、準備（prepare）→ 実行（run）を通す。
 * 承認そのもの（/api/chat のストリームと承認の API）は chat-agent-command.test.ts が担う。DB と Ollama は使わない。
 * プロセスの起動は外部の 3rd-party ではなく、このツールが扱う実依存のため、モックしない。
 */

let base: string;
/** 作業フォルダにしてよいフォルダ（実体のパス） */
let root: string;
/** そのフォルダの外 */
let outside: string;

/** 起動する node の実体のパス（PATH から探した結果と比べる） */
let nodePath: string;

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'local-command-it-'));
  [root] = resolveRoots([await mkdtemp(path.join(base, 'root-'))]);
  outside = path.join(base, 'outside');
  await mkdir(outside);
  await mkdir(path.join(root, '.git'));
  await mkdir(path.join(root, '.ssh'));
  await mkdir(path.join(root, 'sub'));
  nodePath = await realpath(process.execPath);
  // テストを動かす node が PATH の先頭で見つかるようにする（開発者の PATH に別の node があっても結果を揃える）
  vi.stubEnv(
    'PATH',
    `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}`
  );
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(base, { recursive: true, force: true });
});

/**
 * テスト用の run_command を作る。
 *
 * @param timeoutMs - 実行時間の上限（既定 10 秒）
 * @returns run_command のツール
 */
function commandTool(timeoutMs = 10_000): Tool {
  return createRunCommandTool({
    programs: ['node', 'no-such-command-for-it'],
    roots: [root],
    timeoutMs,
  });
}

/**
 * node でスクリプトを実行するコマンドの文字列を作る（引数の区切りを保つため、クォートし直す関数で組む）。
 *
 * @param script - `node -e` に渡すスクリプト
 * @returns コマンドの文字列
 */
function nodeCommand(script: string): string {
  return quoteArgv(['node', '-e', script]);
}

/**
 * ツールの準備を呼ぶ（run_command は必ず prepare を持つ。持たなければテストの前提が崩れているため失敗させる）。
 *
 * @param tool - run_command
 * @param args - ツールへ渡す引数
 * @param signal - 中断の signal
 * @returns 準備の結果
 */
async function prepare(
  tool: Tool,
  args: Record<string, unknown>,
  signal = new AbortController().signal
): Promise<PreparedAction> {
  if (!tool.prepare) throw new Error('run_command は prepare を持ちません');
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

/**
 * ファイルがあるかを確かめる。
 *
 * @param file - ファイルのパス
 * @returns あれば true
 */
async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false
  );
}

/**
 * 孫のプロセスを起動し、`delayMs` 後に孫がファイルを作るスクリプト。孫は親の出力の口を引き継ぐ。
 *
 * @param file - 孫が作るファイル
 * @param delayMs - 作るまでの時間
 * @param keepAlive - 親も動き続けるなら true（false なら親はすぐ終わり、孫だけが残る）
 * @returns `node -e` に渡すスクリプト
 */
function spawnGrandchild(file: string, delayMs: number, keepAlive: boolean) {
  const grandchild = `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(file)}, 'x'), ${delayMs})`;
  return (
    `const child = require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'inherit' });` +
    // node の親は、起動した子が終わるまで自分も終わらない。unref して、親だけが先に終わる状況を作る
    (keepAlive ? 'setInterval(() => {}, 1000);' : 'child.unref();')
  );
}

describe('run_command', () => {
  describe('正常系', () => {
    it('準備で実行ファイル・作業フォルダ・クォートし直したコマンドを見せ、許可されたら実行して出力を返す', async () => {
      const prepared = expectPrepared(
        await prepare(commandTool(), {
          command: `node -e "console.log('hello world')"`,
          cwd: root,
        })
      );
      expect(prepared.preview).toEqual({
        action: 'run',
        command: `node -e 'console.log('\\''hello world'\\'')'`,
        executable: nodePath,
        cwd: root,
        timeoutMs: 10_000,
      });

      const output = await prepared.run(new AbortController().signal);
      expect(output.isError).toBe(false);
      expect(output.summary).toBe('終了コード 0');
      expect(output.result).toContain('hello world');
      expect(output.result).toContain(`（作業フォルダ: ${root}）`);
    });

    it('作業フォルダで実行し、標準出力と標準エラー出力の両方を返す', async () => {
      const prepared = expectPrepared(
        await prepare(commandTool(), {
          command: nodeCommand(
            `console.log('cwd=' + process.cwd()); console.error('to stderr')`
          ),
          cwd: path.join(root, 'sub'),
        })
      );
      const output = await prepared.run(new AbortController().signal);
      expect(output.result).toContain(`cwd=${path.join(root, 'sub')}`);
      expect(output.result).toContain('to stderr');
    });

    it('標準入力は閉じて渡す（入力を待つコマンドで止まらない）', async () => {
      const prepared = expectPrepared(
        await prepare(commandTool(), {
          command: nodeCommand(
            `process.stdin.resume(); process.stdin.on('end', () => console.log('stdin closed'))`
          ),
          cwd: root,
        })
      );
      const output = await prepared.run(new AbortController().signal);
      expect(output.result).toContain('stdin closed');
    });
  });

  describe('準正常系', () => {
    it('終了コードが 0 以外なら失敗として、出力と終了コードを返す', async () => {
      const prepared = expectPrepared(
        await prepare(commandTool(), {
          command: nodeCommand(`console.error('boom'); process.exit(3)`),
          cwd: root,
        })
      );
      const output = await prepared.run(new AbortController().signal);
      expect(output.isError).toBe(true);
      expect(output.summary).toBe('終了コード 3');
      expect(output.result).toContain('boom');
    });

    it('サーバーの環境変数のうち、アプリの設定は渡さない', async () => {
      vi.stubEnv('DATABASE_URL', 'postgresql://secret@localhost/db');
      const prepared = expectPrepared(
        await prepare(commandTool(), {
          command: nodeCommand(
            `console.log(JSON.stringify(Object.keys(process.env).sort()))`
          ),
          cwd: root,
        })
      );
      const output = await prepared.run(new AbortController().signal);
      expect(output.result).not.toContain('DATABASE_URL');
      expect(output.result).toContain('"PATH"');
      expect(output.result).toContain('"GIT_TERMINAL_PROMPT"');
    });

    it.each([
      ['許可していないプログラム', 'ls -la', '許可されていません'],
      ['パスでの指定', `${process.execPath} -v`, 'パスではなく名前で'],
      ['相対パスでの指定', './node -v', 'パスではなく名前で'],
      ['パイプ', 'node -v | cat', '1 つずつ実行'],
      ['PATH に無いプログラム', 'no-such-command-for-it', '見つかりません'],
    ])('%sは、準備で理由を返して承認を求めない', async (_, command, reason) => {
      const prepared = await prepare(commandTool(), { command, cwd: root });
      expect(prepared.ok).toBe(false);
      expect(!prepared.ok && prepared.output.result).toContain(reason);
    });

    it.each([
      ['許可したフォルダの外', () => outside, 'フォルダの外'],
      ['.git の中', () => path.join(root, '.git'), '.git'],
      ['秘匿フォルダの中', () => path.join(root, '.ssh'), '.ssh'],
      ['相対パス', () => 'sub', '絶対パス'],
      ['無いフォルダ', () => path.join(root, 'missing'), '見つかりません'],
    ])('作業フォルダが%sなら断る', async (_, cwd, reason) => {
      const prepared = await prepare(commandTool(), {
        command: 'node -v',
        cwd: cwd(),
      });
      expect(prepared.ok).toBe(false);
      expect(!prepared.ok && prepared.output.result).toContain(reason);
    });
  });

  describe('異常系', () => {
    it('実行時間の上限に達したら止め、途中までの出力を返す', async () => {
      const prepared = expectPrepared(
        await prepare(commandTool(500), {
          command: nodeCommand(
            `console.log('started'); setInterval(() => {}, 1000)`
          ),
          cwd: root,
        })
      );
      const output = await prepared.run(new AbortController().signal);
      expect(output).toMatchObject({
        isError: true,
        summary: '0.5 秒で止めました',
      });
      expect(output.result).toContain('started');
    });

    it('停止したら、孫のプロセスまでまとめて止める', async () => {
      const marker = path.join(root, 'grandchild-after-abort.txt');
      const prepared = expectPrepared(
        await prepare(commandTool(), {
          command: nodeCommand(spawnGrandchild(marker, 1_500, true)),
          cwd: root,
        })
      );
      const controller = new AbortController();
      const running = prepared.run(controller.signal);
      setTimeout(() => controller.abort(), 300);

      expect(await running).toMatchObject({
        isError: true,
        summary: '停止しました',
      });
      // 孫が生きていれば 1.5 秒後にファイルを作る。それより後まで待って、作られていないことを確かめる
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      expect(await exists(marker)).toBe(false);
    });

    it('親が先に終わっても、残った孫のプロセスを止めて待たずに返る', async () => {
      const marker = path.join(root, 'grandchild-after-exit.txt');
      const prepared = expectPrepared(
        await prepare(commandTool(), {
          command: nodeCommand(spawnGrandchild(marker, 1_500, false)),
          cwd: root,
        })
      );
      const output = await prepared.run(new AbortController().signal);
      expect(output.isError).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      expect(await exists(marker)).toBe(false);
    });

    it('承認を経ずに execute で呼ばれたら実行しない', async () => {
      const output = await commandTool().execute(
        { command: 'node -v', cwd: root },
        new AbortController().signal
      );
      expect(output).toMatchObject({
        isError: true,
        summary: expect.stringContaining('承認が必要'),
      });
    });
  });
});
