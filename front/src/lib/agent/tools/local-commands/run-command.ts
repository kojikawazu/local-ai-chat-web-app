import type { Tool, ToolExecution } from '../types';
import { toolError, toolNeedsApproval } from '../output';
import type { CommandApprovalPreview } from '@/types/agent/tool-call';
import { parseCommandLine, quoteArgv } from './parse';
import { findExecutable, resolveWorkingDir } from './resolve';
import { buildCommandEnv, runProcess } from './process';
import type { ProcessResult } from './process';

/**
 * ループの実行時間の上限を、コマンドの上限より長くする分（ミリ秒）。
 * ツールの中で先に止めて途中までの出力を返し、ループの上限は止まらなかったときの保険にするため
 */
const RUN_TIMEOUT_MARGIN_MS = 10_000;

/** {@link createRunCommandTool} の指定。 */
type RunCommandConfig = {
  /** 実行してよいプログラムの名前（`LOCAL_COMMANDS`） */
  programs: string[];
  /** 作業フォルダにしてよいフォルダ（`LOCAL_FILE_WRITE_ROOTS` の実体のパス） */
  roots: string[];
  /** コマンドの実行時間の上限（ミリ秒。`LOCAL_COMMAND_TIMEOUT_MS`） */
  timeoutMs: number;
};

/**
 * ミリ秒を、秒の表示（小数 1 桁まで）にする。
 *
 * @param ms - ミリ秒
 * @returns `2.3 秒` の形
 */
function formatSeconds(ms: number): string {
  return `${Number((ms / 1000).toFixed(1))} 秒`;
}

/**
 * コマンドの実行結果を、モデルへ返す文章と画面の要約にする（#148 Phase B。`docs/16-command-execution.md`「出力と結果」）。
 *
 * 終了コードが 0 以外でも出力は返す（失敗の出力をモデルが読んで直せるように）。
 *
 * @param preview - 承認で見せた内容（コマンド・作業フォルダ・上限）
 * @param result - プロセスの終わり方・出力
 * @returns ツールの実行結果
 */
export function formatCommandResult(
  preview: CommandApprovalPreview,
  result: ProcessResult
): ToolExecution {
  const { end, output } = result;
  const header = `$ ${preview.command}\n（作業フォルダ: ${preview.cwd}）`;
  const silent = output.trim() === '';
  const body = silent ? '（出力なし）' : output.trimEnd();

  switch (end.kind) {
    case 'exited':
      // 出力の無い成功（git add 等）はコマンドでは普通のため、検索の 0 件のような空振り（isEmpty）にはしない。
      // 所要時間は画面が別に出すため、要約には入れない
      return {
        result: `${header}\n終了コード: ${end.code}\n--- 出力 ---\n${body}`,
        isError: end.code !== 0,
        summary: `終了コード ${end.code}${silent ? '・出力なし' : ''}`,
      };
    case 'timeout':
      return {
        result: `${header}\nタイムアウト（${formatSeconds(preview.timeoutMs)}）で止めました。途中までの出力:\n--- 出力 ---\n${body}`,
        isError: true,
        summary: `${formatSeconds(preview.timeoutMs)}で止めました`,
      };
    case 'signaled':
      return {
        result: `${header}\n${end.signal} で終了しました\n--- 出力 ---\n${body}`,
        isError: true,
        summary: `${end.signal} で終了`,
      };
    case 'aborted':
      // 停止・切断ではループごと止まり、この結果はモデルへ返らない。記録のためだけに作る
      return {
        result: `${header}\n停止したため、実行を止めました`,
        isError: true,
        summary: '停止しました',
      };
    case 'spawn-error':
      return toolError(
        `「${preview.command}」を起動できませんでした（${end.message}）`
      );
  }
}

/**
 * コマンドを実行するツールを作る（#148 Phase B。`docs/16-command-execution.md`）。
 *
 * 実行前に承認が要る。準備（`prepare`）で「解釈 → 許可リスト → 実行ファイルの場所 → 作業フォルダ」を確かめ、
 * 許可されたら（`run`）準備で決めた実行ファイル・引数・作業フォルダをそのまま、シェルを介さずに実行する。
 *
 * @param config - 実行してよいプログラム・作業フォルダにしてよいフォルダ・実行時間の上限
 * @returns `run_command` のツール
 */
export function createRunCommandTool({
  programs,
  roots,
  timeoutMs,
}: RunCommandConfig): Tool {
  const allowed = new Set(programs);
  const programList = programs.join(', ');
  return {
    // ローカルの中身を出力に含むため、成功した後はその応答で外部と通信するツールを止める（ファイルを読んだときと同じ）
    access: 'local',
    runTimeoutMs: timeoutMs + RUN_TIMEOUT_MARGIN_MS,
    definition: {
      name: 'run_command',
      description:
        'ローカル PC でコマンドを 1 つ実行し、終わるまで待って出力と終了コードを返す（テストを回す・git の状態を見る等）。' +
        '実行前に利用者が内容を見て許可する。シェルは使わないため、パイプ・リダイレクト・&& は使えず、ワイルドカード・~・環境変数は展開されない。' +
        `実行できるプログラム: ${programList}。` +
        `${formatSeconds(timeoutMs)}で終わらないコマンド（開発サーバー・監視モード）は止められる。`,
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: `実行するコマンド（例: "git status"）。先頭は次のどれか: ${programList}`,
          },
          cwd: {
            type: 'string',
            description: `作業フォルダの絶対パス。使えるフォルダ（の中）: ${roots.join(', ')}`,
          },
        },
        required: ['command', 'cwd'],
      },
    },
    async execute() {
      return toolNeedsApproval();
    },
    async prepare(args) {
      const parsed = parseCommandLine(args.command);
      if (!parsed.ok) return { ok: false, output: toolError(parsed.reason) };
      const [program, ...rest] = parsed.argv;

      if (program.includes('/')) {
        return {
          ok: false,
          output: toolError(
            `プログラムはパスではなく名前で指定してください（「${program}」）。実行できるプログラム: ${programList}`
          ),
        };
      }
      if (!allowed.has(program)) {
        return {
          ok: false,
          output: toolError(
            `「${program}」は実行が許可されていません。実行できるプログラム: ${programList}`
          ),
        };
      }
      const executable = await findExecutable(program, process.env.PATH);
      if (!executable.ok) {
        return { ok: false, output: toolError(executable.reason) };
      }
      const cwd = await resolveWorkingDir(args.cwd, roots);
      if (!cwd.ok) return { ok: false, output: toolError(cwd.reason) };

      const preview: CommandApprovalPreview = {
        action: 'run',
        command: quoteArgv(parsed.argv),
        executable: executable.path,
        cwd: cwd.path,
        timeoutMs,
      };
      return {
        ok: true,
        preview,
        async run(signal) {
          const result = await runProcess({
            executable: executable.path,
            args: rest,
            cwd: cwd.path,
            timeoutMs,
            signal,
            env: buildCommandEnv(process.env),
          });
          return formatCommandResult(preview, result);
        },
      };
    },
  };
}
