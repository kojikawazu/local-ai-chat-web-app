import type { Tool } from '../types';
import { createBrowserActionTool } from './action';
import {
  BROWSER_ACTION_TIMEOUT_MS,
  REF_PARAM,
} from '@/constants/agent/browser';

/** 選ぶ項目の文字の上限。項目の表示の文字には十分な長さ */
const MAX_OPTION_LENGTH = 500;

/** 選べる項目が無いときの理由に並べる項目の数の上限 */
const MAX_LISTED_OPTIONS = 20;

/** 選択欄の 1 つの項目。 */
export type SelectOption = {
  /** 表示の文字 */
  label: string;
  /** 送られる値（`value` 属性） */
  value: string;
  /** 選べない項目なら true */
  disabled: boolean;
};

/**
 * 選ぶ項目を、選択欄の項目から探す（#149 Phase C）。表示の文字で探し、無ければ値で探す（前後の空白は無視する）。
 *
 * @param options - 選択欄の項目（並び順）
 * @param wanted - モデルが渡した項目
 * @returns 見つかった項目の位置（0 始まり）。無ければ -1
 */
export function findOptionIndex(
  options: readonly SelectOption[],
  wanted: string
): number {
  const target = wanted.trim();
  const byLabel = options.findIndex((option) => option.label.trim() === target);
  return byLabel !== -1
    ? byLabel
    : options.findIndex((option) => option.value.trim() === target);
}

/**
 * 今のページの選択欄（`<select>`）で 1 つ選ぶツールを作る（#149 Phase C。`docs/18-browser-tools.md`「Phase C: 操作のツール」）。
 *
 * 実行前に承認が要る。準備で、`<select>` であること・その項目があって選べることを確かめる。複数選択は扱わない（1 つ選ぶ）。
 *
 * @param localOrigins - 開いてよい手元の開発サーバー（`BROWSER_LOCAL_ORIGINS`）
 * @returns `browser_select` のツール
 */
export function createBrowserSelectTool(localOrigins: string[]): Tool {
  return createBrowserActionTool(localOrigins, {
    operation: 'select',
    definition: {
      name: 'browser_select',
      description:
        '今のページの選択欄（combobox）で項目を 1 つ選ぶ。要素はページの内容の [ref=…] の参照で指す。' +
        '実行前に利用者が許可する。操作の後のページの内容を返す。',
      parameters: {
        type: 'object',
        properties: {
          ref: REF_PARAM,
          value: {
            type: 'string',
            description:
              '選ぶ項目の表示の文字（ページの内容の option "要望" の 要望）',
          },
        },
        required: ['ref', 'value'],
      },
    },
    parseArgs(args) {
      if (typeof args.value !== 'string' || args.value.trim() === '') {
        return {
          ok: false,
          reason: 'value は選ぶ項目の文字で指定してください',
        };
      }
      if (args.value.length > MAX_OPTION_LENGTH) {
        return {
          ok: false,
          reason: `value は ${MAX_OPTION_LENGTH} 文字までです`,
        };
      }
      return { ok: true, value: { value: args.value.trim() } };
    },
    async checkElement(locator, element, { value = '' }) {
      const info = await locator
        .evaluate((el) =>
          el instanceof HTMLSelectElement
            ? {
                disabled: el.disabled,
                options: Array.from(el.options, (option) => ({
                  label: option.label,
                  value: option.value,
                  disabled: option.disabled,
                })),
              }
            : null
        )
        .catch(() => undefined);
      if (info === undefined) {
        return { ok: false, reason: `${element} を確かめられませんでした` };
      }
      if (info === null) {
        return {
          ok: false,
          reason: `${element} は選択欄（<select>）ではありません。クリックで開くメニューなら browser_click を使ってください`,
        };
      }
      if (info.disabled) {
        return { ok: false, reason: `${element} は無効のため選べません` };
      }
      const index = findOptionIndex(info.options, value);
      if (index === -1 || info.options[index].disabled) {
        const choices = info.options
          .filter((option) => !option.disabled)
          .slice(0, MAX_LISTED_OPTIONS)
          .map((option) => `「${option.label}」`)
          .join('・');
        return {
          ok: false,
          reason: `${element} に選べる「${value}」の項目がありません。選べる項目: ${choices || '（なし）'}`,
        };
      }
      return {
        ok: true,
        async perform(target) {
          // 同じ表示・値の項目が並ぶこともあるため、準備で確かめた位置で選ぶ
          await target.selectOption(
            { index },
            { timeout: BROWSER_ACTION_TIMEOUT_MS }
          );
        },
      };
    },
  });
}
