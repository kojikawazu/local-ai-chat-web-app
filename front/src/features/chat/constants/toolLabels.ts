/**
 * エージェントツール名を UI 表示用の日本語ラベルへ対応づけるマップ。
 *
 * キーはツール登録名（`lib/tools/` の実装名）。未登録のツール名はラベルが無いため、
 * 表示側でツール名そのものにフォールバックする。
 */
export const TOOL_LABELS: Record<string, string> = {
  get_current_datetime: '日時を取得',
  calculate: '計算',
  web_search: 'Web 検索',
  url_fetch: 'URL を取得',
};
