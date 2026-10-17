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

/** ユーザー入力メッセージ本文の最大文字数（フロント・API 双方でこの上限を検証する）。 */
export const MAX_MESSAGE_LENGTH = 10000;
/**
 * assistant 応答本文の保存上限文字数。
 *
 * LLM の出力長はユーザーが制御できず、長いコード生成で入力上限（{@link MAX_MESSAGE_LENGTH}）を
 * 容易に超えるため別に定める。上限を設けないと保存 API が際限なく大きいボディを受け入れる
 * ため、通常の応答が十分収まる 100,000 文字を安全弁とする。
 */
export const MAX_ASSISTANT_MESSAGE_LENGTH = 100_000;
/** 会話タイトルの最大文字数（自動生成・手動入力とも上限として使う）。 */
export const MAX_TITLE_LENGTH = 100;
