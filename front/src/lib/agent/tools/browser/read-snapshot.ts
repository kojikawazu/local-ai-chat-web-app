import type { Tool } from '../types';
import { toolError } from '../output';
import { getOpenedPage } from './session';
import { formatPageResult, parseOffset, takeSnapshot } from './snapshot';
import {
  BROWSER_NO_CONTEXT_REASON,
  MAX_SNAPSHOT_CHARS,
} from '@/constants/agent/browser';

/**
 * この応答で開いたページを読み直すツールを作る（#149。`docs/18-browser-tools.md`）。
 *
 * 描画を待ってから読み直す・切った続きを `offset` で読むのに使う。ページは開かない（セッションを作らない）。
 * 手元の開発サーバーのページなら、結果の `readLocal` で知らせる。
 *
 * @returns `browser_snapshot` のツール
 */
export function createBrowserSnapshotTool(): Tool {
  return {
    definition: {
      name: 'browser_snapshot',
      description:
        'browser_navigate で開いたページの内容（アクセシビリティツリー）を読み直す。' +
        `1 回に ${MAX_SNAPSHOT_CHARS.toLocaleString('ja-JP')} 文字まで返すので、続きは offset を指定して読む。`,
      parameters: {
        type: 'object',
        properties: {
          offset: {
            type: 'number',
            description:
              '読み始める文字の位置（省略時は 0。前の結果に書かれた値を使う）',
          },
        },
        required: [],
      },
    },
    async execute(args, _signal, context) {
      if (!context) return toolError(BROWSER_NO_CONTEXT_REASON);
      const offset = parseOffset(args.offset);
      if (!offset.ok) return toolError(offset.reason);
      const opened = await getOpenedPage(context);
      if (!opened) {
        return toolError('先に browser_navigate でページを開いてください');
      }
      const { page, session } = opened;
      try {
        const url = page.url();
        return {
          ...formatPageResult({
            url,
            title: await page.title(),
            snapshot: await takeSnapshot(page),
            offset: offset.value,
          }),
          readLocal: session.isLocalUrl(url),
        };
      } catch (e) {
        return toolError(
          `ページを読めませんでした: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`
        );
      }
    },
  };
}
