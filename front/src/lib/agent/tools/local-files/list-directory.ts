import { lstat, readdir } from 'fs/promises';
import path from 'path';
import type { Tool, ToolOutput } from '../types';
import { toolError } from '../output';
import {
  isSecretDirName,
  isSecretFileName,
  isSkippedDirName,
  resolveAllowedPath,
} from './path-guard';
import { formatBytes } from './text';

/** 一覧に出す最大の項目数 */
const MAX_ENTRIES = 200;

/** 一覧の 1 項目。 */
type Entry = {
  /** 名前 */
  name: string;
  /** 種類 */
  kind: 'dir' | 'file' | 'link';
  /** ファイルのバイト数（フォルダ・リンクは無し） */
  size?: number;
};

/** 種類の並び順（フォルダ → ファイル → リンク） */
const KIND_ORDER: Record<Entry['kind'], number> = { dir: 0, file: 1, link: 2 };

/**
 * 一覧を、モデルへ返す文章にする。
 *
 * @param dir - 一覧を出したフォルダ（実体のパス）
 * @param entries - 出す項目（並べ替え済み・上限で切った後）
 * @param hidden - 秘匿ファイル・たどらないフォルダとして出さなかった数
 * @param overflow - 上限を超えて出さなかった数
 * @returns ツールの実行結果
 */
export function formatDirectoryListing(
  dir: string,
  entries: Entry[],
  hidden: number,
  overflow: number
): ToolOutput {
  const lines = entries.map((entry) =>
    entry.kind === 'dir'
      ? `[フォルダ] ${entry.name}/`
      : entry.kind === 'link'
        ? `[リンク] ${entry.name}`
        : `[ファイル] ${entry.name}（${formatBytes(entry.size ?? 0)}）`
  );
  if (overflow > 0) {
    lines.push(
      `（ほかに ${overflow} 件あります。上限 ${MAX_ENTRIES} 件まで表示）`
    );
  }
  if (hidden > 0) {
    lines.push(
      `（秘匿情報を含みうるもの・生成物のフォルダの ${hidden} 件は出していません）`
    );
  }
  const total = entries.length + overflow;
  return {
    result:
      total === 0
        ? `${dir} は空です${hidden > 0 ? `（${hidden} 件は出していません）` : ''}`
        : `${dir} の中身（${total} 件）:\n${lines.join('\n')}`,
    isError: false,
    summary: `${total} 件`,
    isEmpty: total === 0,
  };
}

/**
 * フォルダの直下の一覧を出すツールを作る（#148）。
 *
 * 再帰はしない。秘匿ファイル・読ませないフォルダ・たどらないフォルダは出さず、出さなかった件数を書く。
 * シンボリックリンクは先をたどらず、リンクとして出す。
 *
 * @param roots - 読んでよいフォルダ（実体のパス）
 * @returns `list_directory` のツール
 */
export function createListDirectoryTool(roots: string[]): Tool {
  return {
    access: 'local',
    definition: {
      name: 'list_directory',
      description:
        'ローカル PC のフォルダの直下にあるファイル・フォルダの一覧を返す。読んでよいフォルダの中だけを見られる。' +
        '中を探すときは search_files、ファイルを読むときは read_file を使う。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: `一覧を出すフォルダの絶対パス。読んでよいフォルダ: ${roots.join(', ')}`,
          },
        },
        required: ['path'],
      },
    },
    async execute(args) {
      const resolved = await resolveAllowedPath(args.path, roots);
      if (!resolved.ok) return toolError(resolved.reason);

      let dirents;
      try {
        dirents = await readdir(resolved.path, { withFileTypes: true });
      } catch {
        return toolError(
          `「${resolved.path}」はフォルダではないか、読めません`
        );
      }

      let hidden = 0;
      const visible: Entry[] = [];
      for (const dirent of dirents) {
        if (dirent.isSymbolicLink()) {
          visible.push({ name: dirent.name, kind: 'link' });
        } else if (dirent.isDirectory()) {
          if (isSecretDirName(dirent.name) || isSkippedDirName(dirent.name)) {
            hidden++;
          } else {
            visible.push({ name: dirent.name, kind: 'dir' });
          }
        } else if (dirent.isFile()) {
          if (isSecretFileName(dirent.name)) hidden++;
          else visible.push({ name: dirent.name, kind: 'file' });
        }
      }

      visible.sort(
        (a, b) =>
          KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
          a.name.localeCompare(b.name)
      );
      const shown = visible.slice(0, MAX_ENTRIES);
      // 大きさは出す分だけ調べる（上限を超える大きなフォルダで stat を重ねない）
      await Promise.all(
        shown.map(async (entry) => {
          if (entry.kind !== 'file') return;
          try {
            entry.size = (
              await lstat(path.join(resolved.path, entry.name))
            ).size;
          } catch {
            // 一覧を取った後に消えたファイル。大きさを出さないだけにする
          }
        })
      );
      return formatDirectoryListing(
        resolved.path,
        shown,
        hidden,
        visible.length - shown.length
      );
    },
  };
}
