/** サイドバーの表示状態の保存値（localStorage）。`open` が表示、`closed` が非表示 */
type StoredSidebarVisibility = 'open' | 'closed';

/**
 * localStorage に保存したサイドバーの表示状態を解釈する（#24）。
 *
 * 保存値は書き換えられ得る外部入力のため、`closed` のときだけ非表示にし、それ以外（未保存・不正な値）は表示にする。
 * 表示を既定にするのは、サイドバーにしか無い操作（会話の一覧・検索）を見失わせないため。
 *
 * @param value - localStorage から読んだ値。未保存なら `null`
 * @returns サイドバーを表示するなら `true`
 */
export function parseSidebarVisibility(value: string | null): boolean {
  return value !== 'closed';
}

/**
 * サイドバーの表示状態を、localStorage に保存する値にする（#24）。
 *
 * @param isOpen - サイドバーを表示するか
 * @returns 保存する値（`open` / `closed`）
 */
export function serializeSidebarVisibility(
  isOpen: boolean
): StoredSidebarVisibility {
  return isOpen ? 'open' : 'closed';
}
