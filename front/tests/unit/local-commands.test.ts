import { describe, it, expect } from 'vitest';
import {
  isDeniedProgram,
  parseCommandList,
} from '@/lib/agent/tools/local-commands/config';
import {
  parseCommandLine,
  quoteArgv,
} from '@/lib/agent/tools/local-commands/parse';
import {
  buildCommandEnv,
  cleanOutput,
  createOutputBuffer,
} from '@/lib/agent/tools/local-commands/process';
import { formatCommandResult } from '@/lib/agent/tools/local-commands/run-command';
import type { CommandApprovalPreview } from '@/types/agent/tool-call';

/**
 * コマンドの実行（#148 Phase B）の純ロジックの UT。
 * プロセスの起動・停止・PATH の探索・作業フォルダの判定は、実際のプロセスと fs を使う IT（local-command.test.ts）が担う。
 */

const PREVIEW: CommandApprovalPreview = {
  action: 'run',
  command: 'git status',
  executable: '/usr/bin/git',
  cwd: '/repo',
  timeoutMs: 120_000,
};

describe('parseCommandLine', () => {
  describe('正常系', () => {
    it('空白で区切り、連続する空白・前後の空白は 1 つの区切りとして扱う', () => {
      expect(parseCommandLine('  pnpm   test:unit\ttests/a.test.ts ')).toEqual({
        ok: true,
        argv: ['pnpm', 'test:unit', 'tests/a.test.ts'],
      });
    });

    it('クォートの中の空白は区切らず、空のクォートも 1 つの引数にする', () => {
      expect(
        parseCommandLine(`git commit -m "fix: a b" --author='' x`)
      ).toEqual({
        ok: true,
        argv: ['git', 'commit', '-m', 'fix: a b', '--author=', 'x'],
      });
      expect(parseCommandLine(`node -e ''`)).toEqual({
        ok: true,
        argv: ['node', '-e', ''],
      });
    });

    it('" の中は \\" と \\\\ だけを解釈し、\' の中はそのまま使う', () => {
      expect(parseCommandLine(String.raw`echo "a\"b\\c\n" 'd\"e'`)).toEqual({
        ok: true,
        argv: ['echo', 'a"b\\c\\n', 'd\\"e'],
      });
    });

    it('クォートの外の \\ は次の 1 文字をそのまま使う', () => {
      expect(parseCommandLine(String.raw`ls my\ dir a\|b`)).toEqual({
        ok: true,
        argv: ['ls', 'my dir', 'a|b'],
      });
    });

    it('クォートの中のシェルの記号は、ただの文字として通す', () => {
      expect(parseCommandLine(`git log --format="%h | %s" '$(x)'`)).toEqual({
        ok: true,
        argv: ['git', 'log', '--format=%h | %s', '$(x)'],
      });
    });

    it('ワイルドカード・~・$VAR は展開せずにそのまま渡す', () => {
      expect(parseCommandLine('ls *.ts ~ $HOME')).toEqual({
        ok: true,
        argv: ['ls', '*.ts', '~', '$HOME'],
      });
    });
  });

  describe('準正常系', () => {
    it.each([
      ['パイプ', 'pnpm test | tail -20'],
      ['つなげての実行', 'git add . && git commit'],
      ['セミコロン', 'git status; rm -rf x'],
      ['リダイレクト', 'git diff > out.txt'],
      ['裏で動かす', 'pnpm dev &'],
      ['コマンドの置き換え', 'echo $(whoami)'],
      ['バッククォート', 'echo `whoami`'],
      ['改行', 'git status\nrm -rf x'],
    ])('クォートの外の%sは断る', (_, command) => {
      const result = parseCommandLine(command);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.reason).toContain('1 つずつ実行');
    });

    it('閉じていないクォート・\\ で終わる文字列は断る', () => {
      expect(parseCommandLine(`git commit -m "fix`)).toMatchObject({
        ok: false,
        reason: expect.stringContaining('閉じていません'),
      });
      expect(parseCommandLine('ls a\\')).toMatchObject({ ok: false });
    });
  });

  describe('異常系', () => {
    it.each([
      ['文字列でない', 42],
      ['未指定', undefined],
      ['空白だけ', '   '],
    ])('%s command は断る', (_, command) => {
      expect(parseCommandLine(command)).toMatchObject({
        ok: false,
        reason: expect.stringContaining('command'),
      });
    });

    it('長すぎる・引数が多すぎる・NUL を含む command は断る', () => {
      expect(parseCommandLine('a'.repeat(4_001))).toMatchObject({
        ok: false,
        reason: expect.stringContaining('長すぎます'),
      });
      expect(parseCommandLine(Array(101).fill('a').join(' '))).toMatchObject({
        ok: false,
        reason: expect.stringContaining('引数が多すぎます'),
      });
      expect(parseCommandLine('ls \0')).toMatchObject({ ok: false });
    });
  });
});

describe('quoteArgv', () => {
  describe('正常系', () => {
    it('記号の無い引数はそのまま、空白・クォート・空の引数はシングルクォートで囲む', () => {
      expect(
        quoteArgv(['git', 'commit', '-m', "it's a b", '', 'src/a.ts'])
      ).toBe(`git commit -m 'it'\\''s a b' '' src/a.ts`);
    });

    it('クォートし直した 1 行を解釈し直すと、同じ引数の配列に戻る', () => {
      const argv = ['node', '-e', 'console.log("a b")', "x'y", '$HOME', '|'];
      expect(parseCommandLine(quoteArgv(argv))).toEqual({ ok: true, argv });
    });
  });

  // 準正常系・異常系: 引数の配列を文字列にするだけで、断る入力が無い（どんな文字列もクォートで表せる）
});

describe('parseCommandList / isDeniedProgram', () => {
  describe('正常系', () => {
    it('カンマで区切り、空白・空の要素・重なりを除く', () => {
      expect(parseCommandList(' git, pnpm,,git ,gh ')).toEqual({
        programs: ['git', 'pnpm', 'gh'],
        invalid: [],
        denied: [],
      });
    });
  });

  describe('準正常系', () => {
    it('パス（/ を含む）と、シェル・別のプログラムを起動するものは外す', () => {
      expect(
        parseCommandList('git,/usr/bin/git,./run.sh,bash,Bash,env,sudo,xargs')
      ).toEqual({
        programs: ['git'],
        invalid: ['/usr/bin/git', './run.sh'],
        denied: ['bash', 'Bash', 'env', 'sudo', 'xargs'],
      });
    });

    it('大文字・小文字を区別せずにシェルを判定する（macOS では ZSH でも zsh が起動する）', () => {
      expect(isDeniedProgram('ZSH')).toBe(true);
      expect(isDeniedProgram('git')).toBe(false);
    });
  });

  describe('異常系', () => {
    it('未設定・空文字なら何も許可しない', () => {
      expect(parseCommandList(undefined).programs).toEqual([]);
      expect(parseCommandList('').programs).toEqual([]);
    });
  });
});

describe('buildCommandEnv', () => {
  describe('正常系', () => {
    it('PATH・HOME などだけを引き継ぎ、対話・色を止める変数を足す', () => {
      const env = buildCommandEnv({
        PATH: '/usr/bin',
        HOME: '/Users/me',
        LANG: 'ja_JP.UTF-8',
      });
      expect(env).toMatchObject({
        PATH: '/usr/bin',
        HOME: '/Users/me',
        LANG: 'ja_JP.UTF-8',
        NO_COLOR: '1',
        GIT_TERMINAL_PROMPT: '0',
        PAGER: 'cat',
      });
    });
  });

  describe('準正常系', () => {
    it('アプリの設定（DATABASE_URL・OLLAMA_*・NODE_ENV 等）は渡さない', () => {
      const env = buildCommandEnv({
        PATH: '/usr/bin',
        DATABASE_URL: 'postgresql://dummy-user@dummy-host/dummy-db',
        OLLAMA_BASE_URL: 'http://localhost:11434',
        NODE_ENV: 'development',
        LOCAL_COMMANDS: 'git',
      });
      expect(env).not.toHaveProperty('DATABASE_URL');
      expect(env).not.toHaveProperty('OLLAMA_BASE_URL');
      expect(env).not.toHaveProperty('NODE_ENV');
      expect(env).not.toHaveProperty('LOCAL_COMMANDS');
    });
  });

  describe('異常系', () => {
    it('サーバーに無い変数は足さない（undefined を文字列にしない）', () => {
      expect(buildCommandEnv({})).not.toHaveProperty('PATH');
    });
  });
});

describe('cleanOutput / createOutputBuffer', () => {
  describe('正常系', () => {
    it('色・カーソル移動・リンクの制御文字を取り除き、\\r を改行にする', () => {
      expect(
        cleanOutput(
          '\x1b[32m✓\x1b[0m ok\r\n\x1b]8;;https://a\x07link\x1b]8;;\x07\r50%\r100%'
        )
      ).toBe('✓ ok\nlink\n50%\n100%');
    });

    it('上限までの出力は省かずに返す', () => {
      const buffer = createOutputBuffer(5, 10);
      buffer.push('abc');
      buffer.push('defgh');
      expect(buffer.toString()).toBe('abcdefgh');
    });
  });

  describe('準正常系', () => {
    it('上限を超えたら先頭と末尾だけを残し、省いた文字数を書く', () => {
      const buffer = createOutputBuffer(5, 10);
      for (const chunk of ['01234', '56789', 'abcdefghij', 'KLMNOPQRST']) {
        buffer.push(chunk);
      }
      expect(buffer.toString()).toBe('01234\n…（15 文字を省略）…\nKLMNOPQRST');
    });

    it('細かい出力を何度も足しても、末尾は上限の 2 倍までしか溜めない', () => {
      const buffer = createOutputBuffer(0, 10);
      for (let i = 0; i < 1_000; i++) buffer.push(String(i % 10));
      expect(buffer.toString()).toBe('\n…（990 文字を省略）…\n0123456789');
    });
  });

  // 異常系: 文字列を溜めて返すだけで、失敗する入力が無い
});

describe('formatCommandResult', () => {
  describe('正常系', () => {
    it('終了コード 0 は成功として、コマンド・作業フォルダ・出力を返す', () => {
      const output = formatCommandResult(PREVIEW, {
        end: { kind: 'exited', code: 0 },
        output: 'On branch main\n',
      });
      expect(output).toEqual({
        result:
          '$ git status\n（作業フォルダ: /repo）\n終了コード: 0\n--- 出力 ---\nOn branch main',
        isError: false,
        summary: '終了コード 0',
      });
    });

    it('出力の無い成功は、空振り（isEmpty）にせず成功のまま「出力なし」と書く', () => {
      const output = formatCommandResult(PREVIEW, {
        end: { kind: 'exited', code: 0 },
        output: '\n',
      });
      expect(output).toMatchObject({
        isError: false,
        summary: '終了コード 0・出力なし',
      });
      expect(output).not.toHaveProperty('isEmpty');
      expect(output.result).toContain('（出力なし）');
    });
  });

  describe('準正常系', () => {
    it('終了コード 0 以外は失敗として、出力も返す（モデルが読んで直せるように）', () => {
      const output = formatCommandResult(PREVIEW, {
        end: { kind: 'exited', code: 1 },
        output: 'FAIL tests/a.test.ts\n',
      });
      expect(output).toMatchObject({
        isError: true,
        summary: '終了コード 1',
      });
      expect(output.result).toContain('FAIL tests/a.test.ts');
    });

    it('タイムアウトで止めたら、途中までの出力を返す', () => {
      const output = formatCommandResult(PREVIEW, {
        end: { kind: 'timeout' },
        output: 'running...',
      });
      expect(output).toMatchObject({
        isError: true,
        summary: '120 秒で止めました',
      });
      expect(output.result).toContain('running...');
    });
  });

  describe('異常系', () => {
    it('起動できない・シグナルで終わったら失敗にする', () => {
      expect(
        formatCommandResult(PREVIEW, {
          end: { kind: 'spawn-error', message: 'spawn EACCES' },
          output: '',
        })
      ).toMatchObject({
        isError: true,
        summary: expect.stringContaining('spawn EACCES'),
      });
      expect(
        formatCommandResult(PREVIEW, {
          end: { kind: 'signaled', signal: 'SIGKILL' },
          output: '',
        })
      ).toMatchObject({ isError: true, summary: 'SIGKILL で終了' });
    });
  });
});
