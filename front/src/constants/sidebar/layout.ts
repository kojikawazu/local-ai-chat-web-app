/**
 * デスクトップの幅（サイドバーを出す幅）のメディアクエリ。Tailwind の `md` ブレークポイント（既定 768px）と揃える。
 *
 * これより狭い幅ではサイドバー（`hidden md:flex`）の代わりにドロワーを使う。ドロワーの開閉（`useDrawerDialog`）と、
 * サイドバー・検索のショートカット（#33。デスクトップはサイドバー、狭い幅はドロワーを開く）で使う。
 */
export const DESKTOP_MEDIA_QUERY = '(min-width: 768px)';
