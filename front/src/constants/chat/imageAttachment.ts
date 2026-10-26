/**
 * 添付を受け付ける画像の形式（MIME タイプ。#6）。
 *
 * ブラウザで読める形式に限る。どれも PNG か JPEG に再エンコードしてから送るため、サーバーが受け付ける
 * PNG / JPEG より広い（`docs/13-image-attachment.md`「画像の前処理」）。SVG はスクリプトを含みうるため入れない。
 * ファイル選択の `accept` と、選んだ・落とした・貼り付けたファイルの検証の両方に使う。
 */
export const ACCEPTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;
