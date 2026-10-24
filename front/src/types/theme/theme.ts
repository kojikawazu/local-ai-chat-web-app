/**
 * 選択可能な全テーマの定義一覧。設定モーダルの選択肢として使い、表示順もこの配列順に従う。
 *
 * `as const` は必須。外すと `id` のリテラル型が `string` に広がり、{@link ThemeId} を
 * この配列から導出できなくなる。
 */
export const THEMES = [
  {
    id: 'nordic',
    name: 'Nordic Frost',
    description: '北欧ブルーのデフォルトテーマ',
  },
  {
    id: 'aurora',
    name: 'Aurora Borealis',
    description: '紫とシアンのオーロラテーマ',
  },
  {
    id: 'ocean',
    name: 'Midnight Ocean',
    description: '深海ブルーのダークテーマ',
  },
] as const;

/**
 * 選択可能なテーマの識別子。CSS 変数の切り替えキーとして使う。
 *
 * `globals.css` の `[data-theme='...']` セレクタと値を一致させる必要がある
 * （既定テーマの `nordic` のみ `data-theme` 属性を付けずに表現する）。
 */
export type ThemeId = (typeof THEMES)[number]['id'];

/**
 * 設定 UI に表示する 1 テーマの定義（{@link THEMES} の要素型）。
 */
export type ThemeOption = (typeof THEMES)[number];
