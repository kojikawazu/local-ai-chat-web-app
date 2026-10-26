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
/**
 * 図のソース（Mermaid・PlantUML のコードブロックの本文）の最大文字数（#171）。
 *
 * mermaid の `maxTextSize` の既定（50,000 文字）に揃える。PlantUML はサーバーへ送る前にこの上限で止め、
 * 際限なく大きいソースで PlantUML サーバーを占有させない。
 */
export const MAX_DIAGRAM_SOURCE_LENGTH = 50_000;
/**
 * 1 メッセージに添付できる画像の最大枚数（#6）。
 *
 * 長辺 {@link MAX_IMAGE_LONG_EDGE}px の画像は `qwen3.8:27b` で 1 枚 約 900 トークン・約 8 秒かかる。
 * 4 枚で応答まで 30 秒程度に収める（`docs/13-image-attachment.md`「解像度と処理時間」）。
 */
export const MAX_IMAGES_PER_MESSAGE = 4;
/**
 * `/api/chat` の 1 回の送信で LLM へ渡す画像の最大枚数（送信する質問と履歴の合計。#6）。
 *
 * システムプロンプトの先頭に分単位の日時が入り、送信のたびに Ollama のプロンプトのキャッシュが外れるため、
 * 履歴の画像も毎回評価し直しになる。超えた分は古い順に渡さない。
 */
export const MAX_IMAGES_PER_REQUEST = 8;
/**
 * 添付する画像の長辺の最大ピクセル数（#6）。ブラウザはこれを超える画像を縮小してから送る。
 *
 * 画像のトークン数は解像度にほぼ比例する（1920×1080 で 約 2,000 トークン・約 19 秒）。
 * 1,280px なら 約 900 トークン・約 8 秒に収まり、スクリーンショットの文字も読める。
 */
export const MAX_IMAGE_LONG_EDGE = 1280;
/**
 * 添付する画像 1 枚の最大バイト数（ブラウザでの再エンコード後。保存 API の検証にも使う。#6）。
 *
 * 長辺 {@link MAX_IMAGE_LONG_EDGE}px の PNG が超えるのは稀。保存 API のボディが
 * 際限なく大きくならないための上限（4 枚の Base64 で 約 27MB）。
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/**
 * 添付する元の画像ファイルの最大バイト数（ブラウザでの縮小の前。画面だけで使う。#6）。
 *
 * 縮小のためにブラウザが画像を展開するため、際限なく大きいファイルで画面が固まらないようにする。
 * 一眼レフ・スマートフォンの写真（数 MB〜十数 MB）は通す。
 */
export const MAX_IMAGE_SOURCE_BYTES = 20 * 1024 * 1024;
