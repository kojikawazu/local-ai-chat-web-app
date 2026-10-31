import { describe, it, expect } from 'vitest';
import type { PromptTemplate } from '@/types/prompt-template/prompt-template';
import {
  filterTemplates,
  getSuggestionOptionId,
  getTemplateQuery,
  moveSuggestionIndex,
} from '@/lib/prompt-template/suggest';
import { parsePromptTemplateBody } from '@/lib/server/request-body';
import {
  isValidPromptTemplateShortcut,
  MAX_MESSAGE_LENGTH,
  MAX_PROMPT_TEMPLATE_NAME_LENGTH,
  MAX_PROMPT_TEMPLATE_SHORTCUT_LENGTH,
} from '@/lib/shared/validation';

/**
 * プロンプトテンプレート（#28）の UT。入力欄の候補を出す条件・絞り込み・選択の移動と、
 * ショートカットの形・作成 / 置き換えのボディの検証を確かめる。純関数のため mock は使わない。
 */

/**
 * 絞り込みの検証用のテンプレートを作る。
 *
 * @param shortcut - ショートカット（ID にも使う）
 * @param name - 名前
 * @returns テンプレート（本文・日時は絞り込みに関係しないため固定）
 */
function template(shortcut: string, name: string): PromptTemplate {
  return {
    id: shortcut,
    name,
    shortcut,
    content: `${name}の本文`,
    createdAt: '2026-10-31T00:00:00.000Z',
    updatedAt: '2026-10-31T00:00:00.000Z',
  };
}

/** API と同じショートカットの昇順に並べた一覧 */
const TEMPLATES = [
  template('review', 'コードレビュー'),
  template('summarize', '要約'),
  template('translate', '英語に翻訳'),
  template('tr-ja', '日本語に翻訳'),
];

/**
 * 正しいボディ。各ケースで 1 項目だけ壊して使う。
 *
 * @param overrides - 上書きする項目
 * @returns ボディ
 */
function body(overrides: Record<string, unknown> = {}) {
  return {
    name: '英語に翻訳',
    shortcut: 'translate',
    content: '以下を英語に翻訳してください。\n\n',
    ...overrides,
  };
}

describe('正常系', () => {
  it('入力欄の先頭が / なら、後ろの文字列を絞り込みの語にする', () => {
    expect(getTemplateQuery('/')).toBe('');
    expect(getTemplateQuery('/tr')).toBe('tr');
  });

  it('語が空なら全件を渡された順で返す', () => {
    expect(filterTemplates(TEMPLATES, '').map((t) => t.shortcut)).toEqual([
      'review',
      'summarize',
      'translate',
      'tr-ja',
    ]);
  });

  it('ショートカットの前方一致を先に、続けて名前の部分一致を並べる', () => {
    const shortcuts = (query: string) =>
      filterTemplates(TEMPLATES, query).map((t) => t.shortcut);
    expect(shortcuts('tr')).toEqual(['translate', 'tr-ja']);
    // 「翻訳」はショートカットに無く、名前に含む 2 件
    expect(shortcuts('翻訳')).toEqual(['translate', 'tr-ja']);
  });

  it('ショートカットにも名前にも当たるものは 1 回だけ並べる', () => {
    const templates = [template('sum', 'summary'), template('abc', 'sum up')];
    expect(filterTemplates(templates, 'sum').map((t) => t.shortcut)).toEqual([
      'sum',
      'abc',
    ]);
  });

  it('大文字・小文字を区別しない', () => {
    expect(filterTemplates(TEMPLATES, 'TR').map((t) => t.shortcut)).toEqual([
      'translate',
      'tr-ja',
    ]);
  });

  it('↑↓ で選択を動かし、端では反対の端へ回る', () => {
    expect(moveSuggestionIndex(0, 1, 3)).toBe(1);
    expect(moveSuggestionIndex(2, 1, 3)).toBe(0);
    expect(moveSuggestionIndex(0, -1, 3)).toBe(2);
  });

  it('候補の要素の ID は一覧の ID と位置から作る', () => {
    expect(getSuggestionOptionId(':r1:', 2)).toBe(':r1:-option-2');
  });

  it('ショートカットは英小文字・数字・-・_ を使える', () => {
    expect(isValidPromptTemplateShortcut('translate')).toBe(true);
    expect(isValidPromptTemplateShortcut('tr-ja_2')).toBe(true);
    expect(isValidPromptTemplateShortcut('2fa')).toBe(true);
  });

  it('正しいボディは名前の空白を除き、ショートカットを小文字にし、本文の改行を残す', () => {
    expect(
      parsePromptTemplateBody(
        body({ name: '  英語に翻訳  ', shortcut: ' Translate ' })
      )
    ).toEqual({
      ok: true,
      value: {
        name: '英語に翻訳',
        shortcut: 'translate',
        content: '以下を英語に翻訳してください。\n\n',
      },
    });
  });

  it('上限ちょうどの名前・ショートカット・本文は通す', () => {
    const result = parsePromptTemplateBody(
      body({
        name: 'あ'.repeat(MAX_PROMPT_TEMPLATE_NAME_LENGTH),
        shortcut: 'a'.repeat(MAX_PROMPT_TEMPLATE_SHORTCUT_LENGTH),
        content: 'a'.repeat(MAX_MESSAGE_LENGTH),
      })
    );
    expect(result.ok).toBe(true);
  });
});

describe('準正常系', () => {
  it('先頭が / でない・途中の / では候補を出さない', () => {
    expect(getTemplateQuery('')).toBeNull();
    expect(getTemplateQuery('see https://example.com/a')).toBeNull();
    expect(getTemplateQuery(' /tr')).toBeNull();
  });

  it('全角の ／ では候補を出さない', () => {
    expect(getTemplateQuery('／tr')).toBeNull();
  });

  it('空白・改行を打ったら候補を閉じる', () => {
    expect(getTemplateQuery('/tr ')).toBeNull();
    expect(getTemplateQuery('/translate こんにちは')).toBeNull();
    expect(getTemplateQuery('/tr\n')).toBeNull();
  });

  it('一致するものが無ければ空配列', () => {
    expect(filterTemplates(TEMPLATES, 'zzz')).toEqual([]);
    expect(filterTemplates([], '')).toEqual([]);
  });

  it('候補が無いときの選択の移動は 0', () => {
    expect(moveSuggestionIndex(0, 1, 0)).toBe(0);
  });

  it('ショートカットの形が合わなければ偽', () => {
    expect(isValidPromptTemplateShortcut('')).toBe(false);
    expect(isValidPromptTemplateShortcut('-tr')).toBe(false);
    expect(isValidPromptTemplateShortcut('_tr')).toBe(false);
    expect(isValidPromptTemplateShortcut('/tr')).toBe(false);
    expect(isValidPromptTemplateShortcut('tr ja')).toBe(false);
    expect(isValidPromptTemplateShortcut('翻訳')).toBe(false);
    expect(isValidPromptTemplateShortcut('Translate')).toBe(false);
    expect(
      isValidPromptTemplateShortcut(
        'a'.repeat(MAX_PROMPT_TEMPLATE_SHORTCUT_LENGTH + 1)
      )
    ).toBe(false);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['名前が空白だけ', { name: '   ' }, '名前を入力してください'],
    [
      '名前が上限超過',
      { name: 'あ'.repeat(MAX_PROMPT_TEMPLATE_NAME_LENGTH + 1) },
      `名前は${MAX_PROMPT_TEMPLATE_NAME_LENGTH}文字以内で入力してください`,
    ],
    [
      'ショートカットが空',
      { shortcut: ' ' },
      'ショートカットを入力してください',
    ],
    [
      'ショートカットに / を付けた',
      { shortcut: '/translate' },
      'ショートカットは',
    ],
    ['ショートカットが日本語', { shortcut: '翻訳' }, 'ショートカットは'],
    ['本文が空白・改行だけ', { content: ' \n ' }, '本文を入力してください'],
    [
      '本文が上限超過',
      { content: 'a'.repeat(MAX_MESSAGE_LENGTH + 1) },
      '本文は10,000文字以内で入力してください',
    ],
  ])('%s なら失敗', (_label, overrides, error) => {
    const result = parsePromptTemplateBody(body(overrides));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(error);
  });
});

describe('異常系', () => {
  it.each<[string, unknown]>([
    ['null', null],
    ['配列', []],
    ['文字列', 'translate'],
  ])('ボディが %s なら失敗', (_label, value) => {
    expect(parsePromptTemplateBody(value)).toEqual({
      ok: false,
      error: 'リクエストボディはJSONオブジェクトで指定してください',
    });
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['name が数値', { name: 1 }, 'nameは文字列で指定してください'],
    [
      'shortcut が null',
      { shortcut: null },
      'shortcutは文字列で指定してください',
    ],
    [
      'content が無い',
      { content: undefined },
      'contentは文字列で指定してください',
    ],
  ])('%s なら失敗', (_label, overrides, error) => {
    expect(parsePromptTemplateBody(body(overrides))).toEqual({
      ok: false,
      error,
    });
  });
});
