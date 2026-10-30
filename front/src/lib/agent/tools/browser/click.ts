import type { Tool } from '../types';
import { createBrowserActionTool } from './action';
import {
  BROWSER_ACTION_TIMEOUT_MS,
  REF_PARAM,
} from '@/constants/agent/browser';

/**
 * 今のページの要素をクリックするツールを作る（#149 Phase C。`docs/18-browser-tools.md`「Phase C: 操作のツール」）。
 *
 * 実行前に承認が要る。ボタン・リンク・チェックボックスなど、クリックで動く要素を参照で指す。
 *
 * @param localOrigins - 開いてよい手元の開発サーバー（`BROWSER_LOCAL_ORIGINS`）
 * @returns `browser_click` のツール
 */
export function createBrowserClickTool(localOrigins: string[]): Tool {
  return createBrowserActionTool(localOrigins, {
    operation: 'click',
    definition: {
      name: 'browser_click',
      description:
        '今のページの要素（ボタン・リンク・チェックボックス等）をクリックする。要素はページの内容の [ref=…] の参照で指す。' +
        '実行前に利用者が許可する。操作の後のページの内容を返す。',
      parameters: {
        type: 'object',
        properties: { ref: REF_PARAM },
        required: ['ref'],
      },
    },
    parseArgs: () => ({ ok: true, value: {} }),
    async checkElement() {
      return {
        ok: true,
        perform: (locator) =>
          locator.click({ timeout: BROWSER_ACTION_TIMEOUT_MS }),
      };
    },
  });
}
