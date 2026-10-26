import type { MessageImage } from '@/types/chat/message';

/**
 * 送信前に添付した画像（#6）。ブラウザで縮小・再エンコード済みで、そのまま保存 API へ送れる。
 *
 * 表示の情報（{@link MessageImage}）に、保存 API へ送る画像の中身を足したもの。
 * 送信すると中身を除いた {@link MessageImage} としてメッセージに付く。
 */
export type PreparedImage = MessageImage & {
  /** 画像の中身（`data:` の接頭辞なしの Base64）。保存 API の `attachments[].data` に送る */
  data: string;
};
