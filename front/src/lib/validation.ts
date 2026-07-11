const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 文字列が UUID 形式かどうかを検証する。パスパラメータ `[id]` の検証に使う。
 *
 * @param id - 検証対象の文字列
 * @returns UUID 形式（8-4-4-4-12 の 16 進、大文字小文字不問）なら true
 */
export function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

/** メッセージ本文の最大文字数（フロント・API 双方でこの上限を検証する）。 */
export const MAX_MESSAGE_LENGTH = 10000;
/** 会話タイトルの最大文字数（自動生成・手動入力とも上限として使う）。 */
export const MAX_TITLE_LENGTH = 100;
