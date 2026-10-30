import type { Tool } from '../types';
import { createBrowserActionTool } from './action';
import {
  BROWSER_ACTION_TIMEOUT_MS,
  REF_PARAM,
} from '@/constants/agent/browser';

/** 入れる文字の上限。フォームの入力には足り、承認カードで読める量にする（`docs/18-browser-tools.md`「Phase C の上限値」） */
const MAX_TYPE_TEXT_LENGTH = 5_000;

/** 入力できるかを確かめるのに待つ時間（ミリ秒）。要素は準備で見つけてあるため、待つ必要はほぼ無い */
const EDITABLE_CHECK_TIMEOUT_MS = 1_000;

/**
 * モデルが渡した `submit` を読む。文字列の `"true"`・`"false"` も受け付ける（モデルが文字列で渡すことがあるため）。
 *
 * @param raw - モデルが渡した値。省略なら false
 * @returns 真偽値。読めなければ `undefined`
 */
export function parseSubmit(raw: unknown): boolean | undefined {
  if (raw === undefined || raw === null || raw === '') return false;
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
}

/**
 * 今のページの入力欄に文字を入れるツールを作る（#149 Phase C。`docs/18-browser-tools.md`「Phase C: 操作のツール」）。
 *
 * 実行前に承認が要る。今の値は置き換える（Playwright の `fill`）。`submit` なら入れた後に Enter を押す。
 * パスワード欄には入れない（入れた文字が会話の記録と承認カードに残るため）。
 *
 * @param localOrigins - 開いてよい手元の開発サーバー（`BROWSER_LOCAL_ORIGINS`）
 * @returns `browser_type` のツール
 */
export function createBrowserTypeTool(localOrigins: string[]): Tool {
  return createBrowserActionTool(localOrigins, {
    operation: 'type',
    definition: {
      name: 'browser_type',
      description:
        '今のページの入力欄に文字を入れる（今の値は置き換える）。要素はページの内容の [ref=…] の参照で指す。' +
        '実行前に利用者が許可する。操作の後のページの内容を返す。パスワード欄には入れられない。',
      parameters: {
        type: 'object',
        properties: {
          ref: REF_PARAM,
          text: {
            type: 'string',
            description: `入れる文字（${MAX_TYPE_TEXT_LENGTH.toLocaleString('ja-JP')} 文字まで）`,
          },
          submit: {
            type: 'boolean',
            description:
              '入れた後に Enter を押すなら true（検索欄・1 行のフォームの送信）。省略時は false',
          },
        },
        required: ['ref', 'text'],
      },
    },
    parseArgs(args) {
      if (typeof args.text !== 'string') {
        return { ok: false, reason: 'text は文字列で指定してください' };
      }
      if (args.text.length > MAX_TYPE_TEXT_LENGTH) {
        return {
          ok: false,
          reason: `text は ${MAX_TYPE_TEXT_LENGTH.toLocaleString('ja-JP')} 文字までです（${args.text.length.toLocaleString('ja-JP')} 文字）`,
        };
      }
      const submit = parseSubmit(args.submit);
      if (submit === undefined) {
        return {
          ok: false,
          reason: 'submit は true か false で指定してください',
        };
      }
      return { ok: true, value: { value: args.text, submit } };
    },
    async checkElement(locator, element, { value = '', submit }) {
      // スナップショットではパスワード欄もただの textbox に見えるため、要素の type 属性で見分ける
      const kind = await locator
        .evaluate((el) => ({
          tag: el.tagName.toLowerCase(),
          inputType: el instanceof HTMLInputElement ? el.type : undefined,
        }))
        .catch(() => undefined);
      if (!kind)
        return { ok: false, reason: `${element} を確かめられませんでした` };
      if (kind.inputType === 'password') {
        return {
          ok: false,
          reason: `${element} はパスワード欄のため、入力できません（入れた文字が会話の記録に残るため）`,
        };
      }
      // 選択欄は fill で選べないため、browser_select へ案内する
      if (kind.tag === 'select') {
        return {
          ok: false,
          reason: `${element} は選択欄です。browser_select で選んでください`,
        };
      }
      const editable = await locator
        .isEditable({ timeout: EDITABLE_CHECK_TIMEOUT_MS })
        .catch(() => false);
      if (!editable) {
        return {
          ok: false,
          reason: `${element} は文字を入れられる要素ではありません（無効・読み取り専用を含む）`,
        };
      }
      return {
        ok: true,
        async perform(target) {
          await target.fill(value, { timeout: BROWSER_ACTION_TIMEOUT_MS });
          if (submit) {
            await target.press('Enter', { timeout: BROWSER_ACTION_TIMEOUT_MS });
          }
        },
      };
    },
  });
}
