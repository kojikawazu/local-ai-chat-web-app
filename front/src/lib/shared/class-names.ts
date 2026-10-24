/**
 * 条件付きのクラス名を、空白区切りの 1 つの文字列に連結する。
 *
 * `false`・`null`・`undefined`・空文字は捨てる（`cond && 'class'` の形で書けるようにする）。
 * Tailwind のクラスの衝突は解決しない。同じ性質を 2 つのクラスで指定しないこと
 * （atoms は外から渡す `className` を配置に限り、見た目のクラスと重ならないようにしている）。
 * `clsx` 等のライブラリは入れない（この用途にはこれで足りるため。#163）。
 *
 * @param classes - クラス名。偽値は無視する
 * @returns 空白区切りのクラス名
 */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
