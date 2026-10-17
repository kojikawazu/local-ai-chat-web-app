import type { Prisma } from '@/generated/prisma/client';
import type { OllamaChatMessage } from '@/lib/ollama';
import {
  getMaxMessageLength,
  MAX_HISTORY_MESSAGES,
  MAX_MESSAGE_LENGTH,
  MAX_SYSTEM_PROMPT_LENGTH,
  MAX_TITLE_LENGTH,
} from '@/lib/validation';

/**
 * Route Handler の JSON ボディを実行時に検証する関数群（#95）。
 *
 * `request.json()` は `null`・配列・数値も正しい JSON として返すため、型注釈だけでは
 * 分割代入や `.trim()` が実行時に例外を投げて 500 になる。各 route はボディを `unknown` で受け、
 * ここで検証してから DB・Ollama へ渡す。`next/server` には依存させない（UT で直接検証するため）。
 *
 * 任意フィールドは `undefined` と `null` のどちらも「指定なし」として扱う（`metadata` の既存の扱いに揃える）。
 */

/** 検証結果。成功時は検証済みの値、失敗時はクライアントへ返す日本語のエラーメッセージを持つ。 */
export type ParseResult<T> =
  { ok: true; value: T } | { ok: false; error: string };

/** `POST /api/chat` の検証済みボディ。 */
export type ChatBody = {
  /** 前後の空白を除いたユーザーメッセージ */
  message: string;
  /** 会話履歴。`role` と `content` だけに詰め直してある */
  conversationHistory: OllamaChatMessage[];
  /** 使用モデル。未指定なら `lib/ollama.ts` の既定に任せる */
  model?: string;
  /** エージェントモードで実行するか（未指定は false） */
  enableTools: boolean;
  /** エージェントモードで先頭に付けるシステムプロンプト */
  systemPrompt?: string;
};

/** `POST /api/conversations` の検証済みボディ。 */
export type CreateConversationBody = {
  /** 前後の空白を除いたタイトル。未指定・空なら既定タイトル */
  title: string;
};

/** `POST /api/conversations/[id]/messages` の検証済みボディ。 */
export type SaveMessageBody = {
  /** メッセージの発話主体 */
  role: 'user' | 'assistant';
  /** メッセージ本文 */
  content: string;
  /** ツール呼び出し情報・思考過程等。未指定なら保存しない */
  metadata?: Prisma.InputJsonObject;
};

/** `POST /api/conversations/[id]/generate-title` の検証済みボディ。 */
export type GenerateTitleBody = {
  /** タイトル生成の元となるメッセージ */
  message: string;
  /** 使用モデル。未指定なら `lib/ollama.ts` の既定に任せる */
  model?: string;
};

/** 会話履歴・保存で許可する role。`system` は `systemPrompt`、`tool` はサーバー内のエージェントループだけが作る */
const MESSAGE_ROLES = ['user', 'assistant'] as const;

/** タイトル未指定時に使う会話タイトル。 */
const DEFAULT_CONVERSATION_TITLE = '新しい会話';

const INVALID_JSON_ERROR = 'リクエストボディのJSON形式が不正です';
const NOT_OBJECT_ERROR = 'リクエストボディはJSONオブジェクトで指定してください';

/**
 * 値が JSON オブジェクト（配列・`null` を除く）かを判定し、Prisma の JSON 入力型へ絞り込む。
 *
 * `JSON.parse` の戻り値は定義上 JSON 値のみで構成される（`undefined` や関数、
 * 循環参照は現れない）。したがってオブジェクトであることを確認できれば
 * `Prisma.InputJsonObject` として扱って安全であり、キャストが不要になる。
 *
 * @param value - 検証対象の値（JSON 由来を想定）
 * @returns JSON オブジェクトなら true
 */
function isJsonObject(value: unknown): value is Prisma.InputJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 値が許可された role かを判定する。
 *
 * @param value - 判定する値
 * @returns `'user'` / `'assistant'` なら true
 */
function isMessageRole(value: unknown): value is SaveMessageBody['role'] {
  return MESSAGE_ROLES.some((role) => role === value);
}

/**
 * 上限超過のエラーメッセージ用に数値を桁区切りする。
 *
 * @param value - 桁区切りする数値
 * @returns `10,000` 形式の文字列（ロケール既定に依存すると環境で変わるため 'ja-JP' を明示する）
 */
function formatCount(value: number): string {
  return value.toLocaleString('ja-JP');
}

/**
 * 任意の文字列フィールドを検証する。
 *
 * @param value - フィールドの値
 * @param name - エラーメッセージに出すフィールド名
 * @returns 未指定（`undefined` / `null`）なら `value: undefined`、文字列ならその値、それ以外は失敗
 */
function parseOptionalString(
  value: unknown,
  name: string
): ParseResult<string | undefined> {
  if (value == null) return { ok: true, value: undefined };
  if (typeof value !== 'string') {
    return { ok: false, error: `${name}は文字列で指定してください` };
  }
  return { ok: true, value };
}

/**
 * リクエストボディを JSON として読み取る。中身の形は検証しない（各 `parseXxxBody` で検証する）。
 *
 * @param request - 読み取るリクエスト
 * @param options - `allowEmpty` が true なら、空のボディを `{}` として扱う（全項目が任意の API 向け）
 * @returns 読み取った JSON 値。構文が不正な場合（`allowEmpty` でない空ボディを含む）は失敗
 */
export async function readJsonBody(
  request: Request,
  options: { allowEmpty?: boolean } = {}
): Promise<ParseResult<unknown>> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, error: INVALID_JSON_ERROR };
  }

  if (options.allowEmpty && !text.trim()) return { ok: true, value: {} };

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: INVALID_JSON_ERROR };
  }
}

/**
 * 会話履歴を検証し、`role` と `content` だけに詰め直す。
 *
 * クライアントが `tool_calls` などを混ぜても Ollama へは渡さない。
 * 各 `content` の上限は保存 API と同じため、DB から復元した履歴が弾かれることはない。
 *
 * @param value - `conversationHistory` の値
 * @returns 検証済みの履歴（未指定なら空配列）。配列でない・件数超過・要素が不正なら失敗
 */
function parseConversationHistory(
  value: unknown
): ParseResult<OllamaChatMessage[]> {
  if (value == null) return { ok: true, value: [] };
  if (!Array.isArray(value)) {
    return {
      ok: false,
      error: 'conversationHistoryは配列で指定してください',
    };
  }
  if (value.length > MAX_HISTORY_MESSAGES) {
    return {
      ok: false,
      error: `conversationHistoryは${formatCount(MAX_HISTORY_MESSAGES)}件以内で指定してください`,
    };
  }

  const history: OllamaChatMessage[] = [];
  for (const [index, entry] of value.entries()) {
    const label = `conversationHistory[${index}]`;
    if (!isJsonObject(entry)) {
      return { ok: false, error: `${label}はオブジェクトで指定してください` };
    }
    const { role, content } = entry;
    if (!isMessageRole(role)) {
      return {
        ok: false,
        error: `${label}.roleは "user" または "assistant" のみ有効です`,
      };
    }
    if (typeof content !== 'string') {
      return { ok: false, error: `${label}.contentは文字列で指定してください` };
    }
    const maxLength = getMaxMessageLength(role);
    if (content.length > maxLength) {
      return {
        ok: false,
        error: `${label}.contentは${formatCount(maxLength)}文字以内で指定してください`,
      };
    }
    history.push({ role, content });
  }
  return { ok: true, value: history };
}

/**
 * `POST /api/chat` のボディを検証する。
 *
 * @param body - {@link readJsonBody} で読み取った値
 * @returns 検証済みのボディ。オブジェクトでない・`message` が空または上限超過・各フィールドの型や上限が不正なら失敗
 */
export function parseChatBody(body: unknown): ParseResult<ChatBody> {
  if (!isJsonObject(body)) return { ok: false, error: NOT_OBJECT_ERROR };

  const { message } = body;
  if (typeof message !== 'string' || !message.trim()) {
    return { ok: false, error: 'メッセージが空です' };
  }
  const trimmed = message.trim();
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return {
      ok: false,
      error: `メッセージは${formatCount(MAX_MESSAGE_LENGTH)}文字以内で入力してください`,
    };
  }

  const history = parseConversationHistory(body.conversationHistory);
  if (!history.ok) return history;

  const model = parseOptionalString(body.model, 'model');
  if (!model.ok) return model;

  const { enableTools } = body;
  if (enableTools != null && typeof enableTools !== 'boolean') {
    return { ok: false, error: 'enableToolsは真偽値で指定してください' };
  }

  const systemPrompt = parseOptionalString(body.systemPrompt, 'systemPrompt');
  if (!systemPrompt.ok) return systemPrompt;
  if (
    systemPrompt.value !== undefined &&
    systemPrompt.value.length > MAX_SYSTEM_PROMPT_LENGTH
  ) {
    return {
      ok: false,
      error: `systemPromptは${formatCount(MAX_SYSTEM_PROMPT_LENGTH)}文字以内で指定してください`,
    };
  }

  return {
    ok: true,
    value: {
      message: trimmed,
      conversationHistory: history.value,
      model: model.value,
      enableTools: enableTools ?? false,
      systemPrompt: systemPrompt.value,
    },
  };
}

/**
 * `POST /api/conversations` のボディを検証する。
 *
 * @param body - {@link readJsonBody} で読み取った値（空ボディは `{}`）
 * @returns 検証済みのボディ（`title` 未指定・空白のみなら既定タイトル）。オブジェクトでない・`title` が文字列でない・上限超過なら失敗
 */
export function parseCreateConversationBody(
  body: unknown
): ParseResult<CreateConversationBody> {
  if (!isJsonObject(body)) return { ok: false, error: NOT_OBJECT_ERROR };

  const title = parseOptionalString(body.title, 'title');
  if (!title.ok) return title;

  const resolved = title.value?.trim() || DEFAULT_CONVERSATION_TITLE;
  if (resolved.length > MAX_TITLE_LENGTH) {
    return {
      ok: false,
      error: `タイトルは${MAX_TITLE_LENGTH}文字以内で入力してください`,
    };
  }
  return { ok: true, value: { title: resolved } };
}

/**
 * `POST /api/conversations/[id]/messages` のボディを検証する。
 *
 * `metadata` は指定されたのにオブジェクトでない場合、黙って捨てずに失敗にする。
 *
 * @param body - {@link readJsonBody} で読み取った値
 * @returns 検証済みのボディ。オブジェクトでない・`role`/`content` の欠落・型や role の不正・`metadata` が非オブジェクト・本文の上限超過なら失敗
 */
export function parseSaveMessageBody(
  body: unknown
): ParseResult<SaveMessageBody> {
  if (!isJsonObject(body)) return { ok: false, error: NOT_OBJECT_ERROR };

  const { role, content, metadata } = body;
  if (!role || !content) {
    return { ok: false, error: 'roleとcontentは必須です' };
  }
  if (!isMessageRole(role)) {
    return {
      ok: false,
      error: 'roleは "user" または "assistant" のみ有効です',
    };
  }
  if (typeof content !== 'string') {
    return { ok: false, error: 'contentは文字列で指定してください' };
  }
  if (metadata != null && !isJsonObject(metadata)) {
    return {
      ok: false,
      error: 'metadataはオブジェクト形式で指定してください',
    };
  }

  const maxLength = getMaxMessageLength(role);
  if (content.length > maxLength) {
    return {
      ok: false,
      error: `メッセージは${formatCount(maxLength)}文字以内で入力してください`,
    };
  }

  return {
    ok: true,
    value: {
      role,
      content,
      metadata: isJsonObject(metadata) ? metadata : undefined,
    },
  };
}

/**
 * `POST /api/conversations/[id]/generate-title` のボディを検証する。
 *
 * @param body - {@link readJsonBody} で読み取った値
 * @returns 検証済みのボディ。オブジェクトでない・`message` が空・`model` が文字列でないなら失敗
 */
export function parseGenerateTitleBody(
  body: unknown
): ParseResult<GenerateTitleBody> {
  if (!isJsonObject(body)) return { ok: false, error: NOT_OBJECT_ERROR };

  const { message } = body;
  if (typeof message !== 'string' || !message.trim()) {
    return { ok: false, error: 'メッセージが空です' };
  }

  const model = parseOptionalString(body.model, 'model');
  if (!model.ok) return model;

  return { ok: true, value: { message, model: model.value } };
}
