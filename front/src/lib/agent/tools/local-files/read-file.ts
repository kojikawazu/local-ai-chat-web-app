import { readFile, stat } from 'fs/promises';
import path from 'path';
import type { Tool, ToolOutput } from '../types';
import { toolError } from '../output';
import { resolveAllowedPath } from './path-guard';
import { formatBytes, isBinary, sliceLines, splitLines } from './text';

/** 1 回に返す最大の行数。ソースコードで 1 回 約 10,000 文字に収まる量 */
const MAX_LINES = 300;
/**
 * 1 回に返す最大の文字数（行番号を含む）。約 4,000 トークンで、`qwen3.8:27b` が読むのに 30 秒程度
 * （`docs/14-local-file-tools.md`「前提の調査」）
 */
const MAX_CHARS = 12_000;
/** 開くファイルの最大バイト数（2MB）。行を数えるために全体を読むため */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** 行の番号の引数の解釈の結果。 */
type LineArg =
  { ok: true; value: number | undefined } | { ok: false; reason: string };

/**
 * 行の番号の引数を解釈する。モデルは数を文字列で渡すことがあるため、整数の文字列も受け付ける。
 *
 * @param value - 引数の値
 * @param name - 引数の名前（理由の文章に使う）
 * @returns 1 以上の整数。省略なら `undefined`。それ以外は理由
 */
export function parseLineArg(value: unknown, name: string): LineArg {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: undefined };
  }
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isSafeInteger(number) || number < 1) {
    return { ok: false, reason: `${name} は 1 以上の整数で指定してください` };
  }
  return { ok: true, value: number };
}

/**
 * 切り出した行を、モデルへ返す文章にする。
 *
 * @param file - ファイルの実体のパス
 * @param slice - 切り出した結果（{@link sliceLines}）
 * @returns ツールの実行結果
 */
export function formatFileSlice(
  file: string,
  slice: ReturnType<typeof sliceLines>
): ToolOutput {
  const name = path.basename(file);
  if (slice.total === 0) {
    return {
      result: `${file} は空のファイルです`,
      isError: false,
      summary: `${name}（空）`,
      isEmpty: true,
    };
  }
  const range = `${slice.from}〜${slice.to} 行目 / 全 ${slice.total} 行`;
  const lines = [`${file}（${range}）:`, slice.text];
  if (slice.truncated) {
    lines.push(
      `（上限のため ${slice.to} 行目までにしました。続きは start_line に ${slice.to + 1} を指定して読んでください）`
    );
  }
  return {
    result: lines.join('\n'),
    isError: false,
    summary: `${name}（${range}）`,
  };
}

/**
 * ファイルを行番号付きで読むツールを作る（#148）。
 *
 * UTF-8 として読み、行の範囲を指定できる。1 回に返すのは {@link MAX_LINES} 行・{@link MAX_CHARS} 文字まで
 * （超えたら続きの読み方を書く）。バイナリ・{@link MAX_FILE_BYTES} を超えるファイルは読まない。
 *
 * @param roots - 読んでよいフォルダ（実体のパス）
 * @returns `read_file` のツール
 */
export function createReadFileTool(roots: string[]): Tool {
  return {
    access: 'local',
    definition: {
      name: 'read_file',
      description:
        'ローカル PC のテキストファイルを行番号付きで読む。' +
        `1 回に ${MAX_LINES} 行まで。長いファイルは start_line・end_line で範囲を指定して続きを読む。` +
        '.env などの秘匿ファイルとバイナリは読めない。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: `読むファイルの絶対パス。読んでよいフォルダ: ${roots.join(', ')}`,
          },
          start_line: {
            type: 'number',
            description: '読み始める行（1 始まり）。既定は 1',
          },
          end_line: {
            type: 'number',
            description: `読み終わる行（その行を含む）。既定は start_line から ${MAX_LINES} 行`,
          },
        },
        required: ['path'],
      },
    },
    async execute(args) {
      const start = parseLineArg(args.start_line, 'start_line');
      if (!start.ok) return toolError(start.reason);
      const end = parseLineArg(args.end_line, 'end_line');
      if (!end.ok) return toolError(end.reason);
      const startLine = start.value ?? 1;
      if (end.value !== undefined && end.value < startLine) {
        return toolError('end_line は start_line 以上で指定してください');
      }

      const resolved = await resolveAllowedPath(args.path, roots);
      if (!resolved.ok) return toolError(resolved.reason);

      let bytes: Buffer;
      try {
        const info = await stat(resolved.path);
        if (!info.isFile()) {
          return toolError(
            `「${resolved.path}」はファイルではありません。フォルダの中身は list_directory で見てください`
          );
        }
        if (info.size > MAX_FILE_BYTES) {
          return toolError(
            `「${resolved.path}」は大きすぎるため読めません（${formatBytes(info.size)}。上限 ${formatBytes(MAX_FILE_BYTES)}）。search_files の content で必要な行を探してください`
          );
        }
        bytes = await readFile(resolved.path);
      } catch {
        return toolError(`「${resolved.path}」を読めません`);
      }
      if (isBinary(bytes)) {
        return toolError(`「${resolved.path}」はバイナリのため読めません`);
      }

      const lines = splitLines(bytes.toString('utf8'));
      if (lines.length > 0 && startLine > lines.length) {
        return toolError(
          `start_line（${startLine}）がファイルの行数（${lines.length} 行）を超えています`
        );
      }
      return formatFileSlice(
        resolved.path,
        sliceLines(lines, {
          start: startLine,
          end: end.value,
          maxLines: MAX_LINES,
          maxChars: MAX_CHARS,
        })
      );
    },
  };
}
