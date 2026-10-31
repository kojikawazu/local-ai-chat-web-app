import type { PromptTemplate } from '@/types/prompt-template/prompt-template';

/**
 * 入力欄の `/` でテンプレートの候補を出すための純ロジック（#28。`docs/20-prompt-templates.md`「入力欄での呼び出し」）。
 */

/** 候補を出す入力の先頭の文字。全角の `／` は含めない（ショートカットは半角で打つ） */
const TRIGGER = '/';
/** 候補を閉じる文字（空白・改行）。打った時点で、ショートカットではなく文を書いていると見なす */
const WHITESPACE = /\s/;

/**
 * 入力欄の文字列から、候補の絞り込みの語を取り出す。
 *
 * 文の途中の `/`（URL・パス・`A/B`）で候補が出ないよう、入力欄の先頭が `/` のときだけ取り出す。
 *
 * @param content - 入力欄の文字列（前後の空白を除かない）
 * @returns 先頭が `/` で、2 文字目以降に空白・改行が無ければ `/` の後ろの文字列（`/` だけなら空文字）。それ以外は `null`
 */
export function getTemplateQuery(content: string): string | null {
  if (!content.startsWith(TRIGGER)) return null;
  const query = content.slice(TRIGGER.length);
  return WHITESPACE.test(query) ? null : query;
}

/**
 * 絞り込みの語に合うテンプレートを並べる。
 *
 * ショートカットの前方一致を先に、続けて名前の部分一致を並べる（同じものは 1 回だけ）。
 * どちらも大文字・小文字を区別しない。それぞれの中では渡された順（API はショートカットの昇順で返す）を保つ。
 *
 * @param templates - テンプレートの一覧
 * @param query - {@link getTemplateQuery} で取り出した語。空文字なら全件
 * @returns 合うテンプレート（合うものが無ければ空配列）
 */
export function filterTemplates(
  templates: readonly PromptTemplate[],
  query: string
): PromptTemplate[] {
  const needle = query.toLowerCase();
  if (!needle) return [...templates];

  const byShortcut = templates.filter((template) =>
    template.shortcut.toLowerCase().startsWith(needle)
  );
  const byName = templates.filter(
    (template) =>
      !byShortcut.includes(template) &&
      template.name.toLowerCase().includes(needle)
  );
  return [...byShortcut, ...byName];
}

/**
 * 候補の選択を ↑↓ で動かした先の位置を求める。端では反対の端へ回る。
 *
 * @param index - 今の位置（0 始まり）
 * @param delta - 動かす向き（↓ は 1、↑ は -1）
 * @param count - 候補の数
 * @returns 動かした先の位置。候補が無ければ 0
 */
export function moveSuggestionIndex(
  index: number,
  delta: number,
  count: number
): number {
  if (count <= 0) return 0;
  return (((index + delta) % count) + count) % count;
}

/**
 * 候補の 1 件の要素の ID を作る（入力欄の `aria-activedescendant` と候補の `id` を揃えるため）。
 *
 * @param listId - 候補の一覧（`listbox`）の ID
 * @param index - 候補の位置（0 始まり）
 * @returns 候補の要素の ID
 */
export function getSuggestionOptionId(listId: string, index: number): string {
  return `${listId}-option-${index}`;
}
