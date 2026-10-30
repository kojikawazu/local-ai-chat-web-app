/**
 * ブラウザのツール（#149。`docs/18-browser-tools.md`）で複数のファイルから使う値。
 */

/** ページの大きさ。スクリーンショットは約 1,000 トークンになる（`docs/18-browser-tools.md`「前提の調査」） */
export const BROWSER_VIEWPORT = { width: 1280, height: 800 } as const;

/**
 * スナップショットの 1 回の文字数の上限。`read_file` と同じ（約 4,000 トークン・読むのに 30 秒程度。
 * `docs/18-browser-tools.md`「上限値」）
 */
export const MAX_SNAPSHOT_CHARS = 12_000;

/** プロキシが止めた HTTP のリクエストに付けるヘッダー。ブラウザのツールが、ページを止めた理由を読むのに使う */
export const BROWSER_BLOCKED_HEADER = 'x-browser-tool-blocked';

/** ブラウザのツールが、エージェントループの外から（応答ごとの文脈なしで）呼ばれたときの理由 */
export const BROWSER_NO_CONTEXT_REASON =
  'ブラウザのツールはエージェントの応答の中でだけ使えます';
