/**
 * エージェントツール名を UI 表示用の日本語ラベルへ対応づけるマップ。
 *
 * キーはツール登録名（`lib/agent/tools/` の実装名）。未登録のツール名はラベルが無いため、
 * 表示側でツール名そのものにフォールバックする。
 */
export const TOOL_LABELS: Record<string, string> = {
  get_current_datetime: '日時を取得',
  calculate: '計算',
  web_search: 'Web 検索',
  url_fetch: 'URL を取得',
  list_directory: 'フォルダを見る',
  search_files: 'ファイルを探す',
  read_file: 'ファイルを読む',
  run_command: 'コマンドを実行',
  github_list: 'GitHub の一覧',
  github_view: 'GitHub の詳細',
  github_pr_diff: 'PR の差分',
  github_comment: 'GitHub にコメント',
  github_create_pr: 'PR を作成',
  browser_navigate: 'ページを開く',
  browser_snapshot: 'ページを読む',
  browser_screenshot: 'スクリーンショット',
  browser_click: 'クリック',
  browser_type: '入力',
  browser_select: '選択',
};
