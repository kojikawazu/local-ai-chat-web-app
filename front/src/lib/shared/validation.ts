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
/**
 * role ごとのメッセージ本文の上限文字数を返す。保存 API と会話履歴の検証で同じ上限を使う。
 *
 * @param role - メッセージの発話主体
 * @returns user は {@link MAX_MESSAGE_LENGTH}、assistant は {@link MAX_ASSISTANT_MESSAGE_LENGTH}
 */
export function getMaxMessageLength(role: 'user' | 'assistant'): number {
  return role === 'assistant'
    ? MAX_ASSISTANT_MESSAGE_LENGTH
    : MAX_MESSAGE_LENGTH;
}
/** 会話タイトルの最大文字数（自動生成・手動入力とも上限として使う）。 */
export const MAX_TITLE_LENGTH = 100;
/**
 * `/api/chat` の `conversationHistory` に含められる最大件数。
 *
 * クライアントは会話の全履歴を毎回送るため、厳しくすると長い会話を続けられなくなる。
 * 個人利用で届かない 1,000 件を、際限なく大きいボディを受け入れないための安全弁とする。
 */
export const MAX_HISTORY_MESSAGES = 1_000;
/**
 * `/api/chat` の `systemPrompt` の最大文字数。
 *
 * 既存のエージェントプリセットは約 1,000 文字のため、ユーザー入力と同じ 10,000 文字で十分収まる。
 */
export const MAX_SYSTEM_PROMPT_LENGTH = 10_000;
/**
 * 会話に保存する役割（システムプロンプト）の最大文字数（#10）。
 *
 * エージェントモードでは役割の後ろにエージェントのプリセット（約 1,000 文字）を連結して
 * `/api/chat` の `systemPrompt` として送る。連結後も {@link MAX_SYSTEM_PROMPT_LENGTH} に
 * 収まるよう、その半分の 5,000 文字とする（不変条件は UT で検証する）。
 */
export const MAX_CONVERSATION_SYSTEM_PROMPT_LENGTH = 5_000;
/**
 * 会話検索のキーワードの最大文字数（#11）。
 *
 * 探したい語を数語並べる用途には十分な長さ。長文を貼り付けて全メッセージへの部分一致を
 * 走らせないための上限で、検索欄の入力上限にも使う。
 */
export const MAX_SEARCH_QUERY_LENGTH = 100;
/**
 * 会話検索で、空白で区切って AND で探せる語の最大数（#11）。
 *
 * 語ごとに「タイトルかメッセージ本文に含む」条件を足すため、際限なく増やすとクエリが重くなる。
 */
export const MAX_SEARCH_TERMS = 5;
