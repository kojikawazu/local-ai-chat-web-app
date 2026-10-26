import { readFile, readdir, stat } from 'fs/promises';
import path from 'path';
import type { Tool, ToolOutput } from '../types';
import { toolError } from '../output';
import {
  isSecretDirName,
  isSecretFileName,
  isSkippedDirName,
  resolveAllowedPath,
} from './path-guard';
import { isBinary, nameMatcher, splitLines, truncateLine } from './text';

/** 返す最大の件数（ファイル名ならファイル、中身なら一致した行） */
const MAX_RESULTS = 30;
/** たどる最大のファイル数。許可したフォルダが大きくても、時間の上限より先に止める */
const MAX_FILES_SCANNED = 5000;
/** 中身を探すファイルの最大バイト数（1MB）。超えたら中身の検索では飛ばす */
const MAX_CONTENT_BYTES = 1024 * 1024;
/** 一致した行を返すときの最大の文字数（圧縮された JS など 1 行が長いファイル） */
const MAX_LINE_CHARS = 200;
/** 検索語の最大の文字数 */
const MAX_QUERY_LENGTH = 200;

/** 探す対象。 */
type SearchTarget = 'name' | 'content';

/** 探した結果。 */
type SearchResult = {
  /** 見つかったもの（ファイル名ならパス、中身なら `パス:行: 本文`） */
  matches: string[];
  /** 上限の件数に達して打ち切ったか */
  limitReached: boolean;
  /** たどるファイルの数の上限に達して打ち切ったか */
  scanLimitReached: boolean;
  /** 時間切れ・停止で打ち切ったか */
  aborted: boolean;
};

/**
 * 探した結果を、モデルへ返す文章にする。
 *
 * @param query - 検索語
 * @param target - 探した対象
 * @param dir - 探し始めたフォルダ
 * @param result - 探した結果
 * @returns ツールの実行結果。0 件なら `isEmpty`
 */
export function formatSearchResult(
  query: string,
  target: SearchTarget,
  dir: string,
  result: SearchResult
): ToolOutput {
  const what = target === 'name' ? 'ファイル名' : '中身';
  const notes: string[] = [];
  if (result.limitReached) {
    notes.push(
      `（${MAX_RESULTS} 件で打ち切りました。フォルダや検索語を絞ってください）`
    );
  }
  if (result.scanLimitReached) {
    notes.push(
      `（${MAX_FILES_SCANNED} ファイルを調べたところで打ち切りました。フォルダを絞ってください）`
    );
  }
  if (result.aborted) {
    notes.push('（時間の上限に達したため、途中までの結果です）');
  }
  const count = result.matches.length;
  if (count === 0) {
    return {
      result: [
        `${dir} の中に、${what}に「${query}」を含むものは見つかりませんでした`,
        ...notes,
      ].join('\n'),
      isError: false,
      summary: '0 件',
      isEmpty: true,
    };
  }
  return {
    result: [
      `${dir} の中で、${what}に「${query}」を含むもの（${count} 件）:`,
      ...result.matches,
      ...notes,
    ].join('\n'),
    isError: false,
    summary: result.limitReached ? `${count} 件以上` : `${count} 件`,
  };
}

/**
 * フォルダの下をたどって探す。
 *
 * シンボリックリンクはたどらない（許可したフォルダの外・循環に入りうるため）。秘匿ファイル・読ませないフォルダ・
 * たどらないフォルダは飛ばす。件数・ファイル数の上限と `signal` で打ち切る。
 *
 * @param start - 探し始めるフォルダ（許可したフォルダの中の実体のパス）
 * @param query - 検索語
 * @param target - 探す対象
 * @param signal - 時間切れ・停止で中断される signal
 * @returns 探した結果
 */
async function search(
  start: string,
  query: string,
  target: SearchTarget,
  signal: AbortSignal
): Promise<SearchResult> {
  const matchName = nameMatcher(query);
  const lowerQuery = query.toLowerCase();
  const result: SearchResult = {
    matches: [],
    limitReached: false,
    scanLimitReached: false,
    aborted: false,
  };
  const queue = [start];
  let scanned = 0;

  while (queue.length > 0) {
    if (signal.aborted) {
      result.aborted = true;
      return result;
    }
    // 名前順に浅いところから探す（結果の並びを毎回同じにする）。
    // while の条件で空でないことを確かめているため、shift は必ず値を返す
    const dir = queue.shift()!;
    let dirents;
    try {
      dirents = await readdir(dir, { withFileTypes: true });
    } catch {
      continue; // 読めないフォルダ（権限など）は飛ばす
    }
    dirents.sort((a, b) => a.name.localeCompare(b.name));

    for (const dirent of dirents) {
      if (dirent.isSymbolicLink()) continue;
      const fullPath = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        if (!isSecretDirName(dirent.name) && !isSkippedDirName(dirent.name)) {
          queue.push(fullPath);
        }
        continue;
      }
      if (!dirent.isFile() || isSecretFileName(dirent.name)) continue;

      if (++scanned > MAX_FILES_SCANNED) {
        result.scanLimitReached = true;
        return result;
      }
      if (target === 'name') {
        if (matchName(dirent.name)) result.matches.push(fullPath);
      } else {
        await searchContent(fullPath, lowerQuery, result);
      }
      if (result.matches.length >= MAX_RESULTS) {
        result.matches.length = MAX_RESULTS;
        result.limitReached = true;
        return result;
      }
      if (signal.aborted) {
        result.aborted = true;
        return result;
      }
    }
  }
  return result;
}

/**
 * 1 つのファイルの中身から、検索語を含む行を探して結果に足す。
 *
 * 大きすぎる・バイナリ・読めないファイルは飛ばす。
 *
 * @param file - ファイルの実体のパス
 * @param lowerQuery - 小文字にした検索語
 * @param result - 見つかった行を足す先
 */
async function searchContent(
  file: string,
  lowerQuery: string,
  result: SearchResult
): Promise<void> {
  try {
    if ((await stat(file)).size > MAX_CONTENT_BYTES) return;
    const bytes = await readFile(file);
    if (isBinary(bytes)) return;
    const lines = splitLines(bytes.toString('utf8'));
    for (const [index, line] of lines.entries()) {
      if (!line.toLowerCase().includes(lowerQuery)) continue;
      result.matches.push(
        `${file}:${index + 1}: ${truncateLine(line.trim(), MAX_LINE_CHARS)}`
      );
      if (result.matches.length >= MAX_RESULTS) return;
    }
  } catch {
    // 探している間に消えた・権限が無いファイルは飛ばす
  }
}

/**
 * フォルダの下からファイルを探すツールを作る（#148）。
 *
 * ファイル名（`*`・`?` のワイルドカードか部分一致）か、中身（文字列の部分一致。行番号付き）で探す。
 * 大文字・小文字は区別しない。正規表現は受け付けない（モデルが組んだ式で極端に遅くなるのを避ける）。
 *
 * @param roots - 読んでよいフォルダ（実体のパス）
 * @returns `search_files` のツール
 */
export function createSearchFilesTool(roots: string[]): Tool {
  return {
    access: 'local',
    definition: {
      name: 'search_files',
      description:
        'ローカル PC のフォルダの下から、ファイル名か中身で探す。大文字・小文字は区別しない。' +
        `最大 ${MAX_RESULTS} 件。node_modules・.git などの生成物のフォルダと、.env などの秘匿ファイルは探さない。` +
        '見つかったファイルは read_file で読む。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              '探す文字列。ファイル名なら「*.ts」「README*」のように * と ? が使える（正規表現は使えない）',
          },
          path: {
            type: 'string',
            description: `探し始めるフォルダの絶対パス。読んでよいフォルダ: ${roots.join(', ')}`,
          },
          target: {
            type: 'string',
            description:
              '探す対象。name はファイル名、content は中身。既定は name',
            enum: ['name', 'content'],
          },
        },
        required: ['query', 'path'],
      },
    },
    async execute(args, signal) {
      const query = typeof args.query === 'string' ? args.query.trim() : '';
      if (!query) return toolError('query に探す文字列を指定してください');
      if (query.length > MAX_QUERY_LENGTH) {
        return toolError(
          `query は ${MAX_QUERY_LENGTH} 文字以内で指定してください`
        );
      }
      const target = args.target ?? 'name';
      if (target !== 'name' && target !== 'content') {
        return toolError('target は name か content を指定してください');
      }

      const resolved = await resolveAllowedPath(args.path, roots);
      if (!resolved.ok) return toolError(resolved.reason);
      try {
        if (!(await stat(resolved.path)).isDirectory()) {
          return toolError(
            `「${resolved.path}」はフォルダではありません。ファイルを読むときは read_file を使ってください`
          );
        }
      } catch {
        return toolError(`「${resolved.path}」を読めません`);
      }

      const result = await search(resolved.path, query, target, signal);
      return formatSearchResult(query, target, resolved.path, result);
    },
  };
}
