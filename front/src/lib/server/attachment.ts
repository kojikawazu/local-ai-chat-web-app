/**
 * 添付画像（#6）の中身を扱うサーバー側の関数群。
 *
 * 形式はクライアントの申告ではなく、復号したバイト列の先頭（マジックナンバー）で決める。
 * 申告を信じると、SVG（スクリプトを含みうる）などを画像として保存・配信してしまうため。
 */

/** 保存・配信を許可する画像の形式。ブラウザは添付時にこのどちらかへ再エンコードする。 */
export const ATTACHMENT_MIME_TYPES = ['image/png', 'image/jpeg'] as const;

/** 保存・配信を許可する画像の形式（{@link ATTACHMENT_MIME_TYPES} の要素）。 */
export type AttachmentMimeType = (typeof ATTACHMENT_MIME_TYPES)[number];

/** PNG のシグネチャ（先頭 8 バイト。PNG の仕様で固定）。 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** JPEG の SOI マーカーと、続くマーカーの先頭（`FF D8 FF`）。 */
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

/** 標準の Base64（`+` `/`、末尾の `=` は 2 文字まで）。URL 用の `-` `_` や改行・空白は受け付けない。 */
const BASE64_REGEX = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * バイト列が指定のシグネチャで始まるかを判定する。
 *
 * @param bytes - 判定するバイト列
 * @param signature - 先頭に期待するバイトの並び
 * @returns 先頭が一致すれば true
 */
function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return (
    bytes.length >= signature.length &&
    signature.every((byte, index) => bytes[index] === byte)
  );
}

/**
 * バイト列の先頭から画像の形式を判定する。
 *
 * @param bytes - 復号した画像のバイト列
 * @returns PNG / JPEG ならその MIME タイプ。それ以外（GIF・WebP・SVG・画像でないもの）は `null`
 */
export function detectImageMimeType(
  bytes: Uint8Array
): AttachmentMimeType | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png';
  if (startsWith(bytes, JPEG_SIGNATURE)) return 'image/jpeg';
  return null;
}

/**
 * Base64 の文字列を復号する。
 *
 * Node の `Buffer.from(value, 'base64')` は不正な文字を黙って読み飛ばすため、
 * 先に文字の種類と長さを確かめる（壊れた文字列を、壊れた画像として保存しないため）。
 *
 * @param value - `data:` の接頭辞を除いた Base64 の文字列
 * @returns 復号したバイト列。Base64 として不正（空・4 の倍数でない長さ・許可しない文字）なら `null`
 */
export function decodeBase64(value: string): Uint8Array<ArrayBuffer> | null {
  if (!value || value.length % 4 !== 0 || !BASE64_REGEX.test(value)) {
    return null;
  }
  return new Uint8Array(Buffer.from(value, 'base64'));
}

/**
 * Base64 の文字列が復号後に何バイトになるかを、復号せずに求める。
 *
 * 上限を超える巨大な文字列を、復号してから捨てるとメモリを無駄に使うため、復号の前に判定する。
 *
 * @param value - Base64 の文字列（{@link decodeBase64} が受け付ける形）
 * @returns 復号後のバイト数
 */
export function base64DecodedLength(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}
