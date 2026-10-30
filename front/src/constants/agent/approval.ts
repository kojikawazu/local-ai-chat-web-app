/**
 * ツールの実行前の承認（#148 Phase A2。`docs/15-tool-approval.md`）で複数のファイルから使う値。
 */

/**
 * 承認を待つ時間の上限（ミリ秒。5 分）。席を外してもすぐには取り消さず、際限なくも待たない長さ。
 * エージェントループが `tool_approval_request` に載せ、画面は承認カードに残り時間を出す（#202）
 */
export const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
