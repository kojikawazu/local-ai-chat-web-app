import type { Prisma } from '@/generated/prisma/client';
import { DEFAULT_CONVERSATION_TITLE } from '@/constants/conversation/title';
import type { AttachmentMimeType } from '@/lib/server/attachment';
import {
  base64DecodedLength,
  decodeBase64,
  detectImageMimeType,
} from '@/lib/server/attachment';
import {
  getMaxMessageLength,
  isValidPromptTemplateShortcut,
  isValidUUID,
  MAX_ASSISTANT_MESSAGE_LENGTH,
  MAX_BOOKMARK_NOTE_LENGTH,
  MAX_DIAGRAM_SOURCE_LENGTH,
  MAX_CONVERSATION_SYSTEM_PROMPT_LENGTH,
  MAX_HISTORY_MESSAGES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_LONG_EDGE,
  MAX_IMAGES_PER_MESSAGE,
  MAX_MESSAGE_LENGTH,
  MAX_PROMPT_TEMPLATE_NAME_LENGTH,
  MAX_PROMPT_TEMPLATE_SHORTCUT_LENGTH,
  MAX_SYSTEM_PROMPT_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_TOOL_SCREENSHOTS_PER_MESSAGE,
} from '@/lib/shared/validation';

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

/** `POST /api/chat` の会話履歴の 1 件（検証済み）。 */
export type ChatHistoryEntry = {
  /** メッセージの発話主体 */
  role: 'user' | 'assistant';
  /** メッセージ本文 */
  content: string;
  /** そのメッセージの添付画像の ID（#6）。添付が無ければ空配列。assistant は常に空 */
  imageIds: string[];
};

/** `POST /api/chat` の検証済みボディ。 */
export type ChatBody = {
  /** 前後の空白を除いたユーザーメッセージ */
  message: string;
  /** 送信する質問の添付画像の ID（保存済みの添付。#6）。添付が無ければ空配列 */
  imageIds: string[];
  /** 会話履歴。`role`・`content`・`imageIds` だけに詰め直してある */
  conversationHistory: ChatHistoryEntry[];
  /** 使用モデル。未指定なら `lib/llm/ollama.ts` の既定に任せる */
  model?: string;
  /** エージェントモードで実行するか（未指定は false） */
  enableTools: boolean;
  /** 先頭に付けるシステムプロンプト（会話の役割と、エージェントモードならそのプリセットを連結したもの） */
  systemPrompt?: string;
};

/** `POST /api/conversations` の検証済みボディ。 */
export type CreateConversationBody = {
  /** 前後の空白を除いたタイトル。未指定・空なら既定タイトル */
  title: string;
  /** 前後の空白を除いた会話の役割（システムプロンプト）。未指定・空なら `null`（役割なし） */
  systemPrompt: string | null;
};

/** `PATCH /api/conversations/[id]` の検証済みボディ。 */
export type UpdateConversationBody = {
  /** 前後の空白を除いた会話の役割。`null`・空なら役割を外す */
  systemPrompt: string | null;
};

/** `POST /api/conversations/[id]/messages` の検証済みボディ。 */
export type SaveMessageBody = {
  /**
   * クライアントが採番したメッセージ ID（UUID）。未指定なら DB が採番する。
   * 画面上の ID と DB の ID を揃え、再生成で置き換える対象を特定できるようにする（#9）
   */
  id?: string;
  /** メッセージの発話主体 */
  role: 'user' | 'assistant';
  /** メッセージ本文 */
  content: string;
  /** ツール呼び出し情報・思考過程等。未指定なら保存しない */
  metadata?: Prisma.InputJsonObject;
  /**
   * 添付画像（#6）。添付が無ければ空配列。user は添付した画像、assistant はブラウザのツールが撮った画面（#200）
   */
  attachments: AttachmentInput[];
};

/** 保存する添付画像 1 枚（検証・復号済み）。 */
export type AttachmentInput = {
  /**
   * 添付の ID（UUID）。user の添付はクライアントが採番し、`/api/chat` の `imageIds` で参照する。
   * assistant の画面はサーバーが撮ったときに採番し、`metadata.toolCalls[].screenshots` で参照する（#200）
   */
  id: string;
  /** 復号した画像のバイト列 */
  data: Uint8Array<ArrayBuffer>;
  /** バイト列の先頭から判定した形式 */
  mimeType: AttachmentMimeType;
  /** 画像の幅（px）。表示の枠の確保にだけ使う */
  width: number;
  /** 画像の高さ（px）。表示の枠の確保にだけ使う */
  height: number;
};

/** `PUT /api/conversations/[id]/messages/[messageId]` の検証済みボディ（応答の再生成による置き換え）。 */
export type ReplaceMessageBody = {
  /** 置き換え後の応答本文 */
  content: string;
  /** 置き換え後の metadata。未指定なら旧応答の metadata を消す */
  metadata?: Prisma.InputJsonObject;
  /** 置き換え後の応答の画面（#200）。旧応答の画像は消して、これに入れ替える。無ければ空配列 */
  attachments: AttachmentInput[];
};

/** `POST /api/conversations/[id]/generate-title` の検証済みボディ。 */
export type GenerateTitleBody = {
  /** タイトル生成の元となるメッセージ */
  message: string;
  /** 使用モデル。未指定なら `lib/llm/ollama.ts` の既定に任せる */
  model?: string;
};

/** `POST /api/diagrams/plantuml` の検証済みボディ（#171）。 */
export type PlantUmlBody = {
  /** PlantUML のソース（前後の空白を含め、書かれたまま PlantUML サーバーへ送る） */
  source: string;
};

/** `POST /api/prompt-templates`・`PUT /api/prompt-templates/[id]` の検証済みボディ（#28）。 */
export type PromptTemplateBody = {
  /** 前後の空白を除いた名前 */
  name: string;
  /** 前後の空白を除き、小文字にしたショートカット（先頭の `/` は含めない） */
  shortcut: string;
  /** 本文。末尾の改行に意味があるため、前後の空白・改行も書いたまま残す */
  content: string;
};

/** 会話履歴・保存で許可する role。`system` は `systemPrompt`、`tool` はサーバー内のエージェントループだけが作る */
const MESSAGE_ROLES = ['user', 'assistant'] as const;

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
 * 添付画像の ID の配列を検証する（#6）。
 *
 * @param value - ID の配列の値
 * @param name - エラーメッセージに出すフィールド名
 * @returns 検証済みの ID（未指定なら空配列）。配列でない・{@link MAX_IMAGES_PER_MESSAGE} 枚を超える・UUID 形式でない・重複があるなら失敗
 */
function parseImageIds(value: unknown, name: string): ParseResult<string[]> {
  if (value == null) return { ok: true, value: [] };
  if (!Array.isArray(value)) {
    return { ok: false, error: `${name}は配列で指定してください` };
  }
  if (value.length > MAX_IMAGES_PER_MESSAGE) {
    return {
      ok: false,
      error: `画像は1メッセージにつき${MAX_IMAGES_PER_MESSAGE}枚までです`,
    };
  }
  const ids: string[] = [];
  for (const id of value) {
    if (typeof id !== 'string' || !isValidUUID(id)) {
      return { ok: false, error: `${name}の要素はUUID形式で指定してください` };
    }
    if (ids.includes(id)) {
      return { ok: false, error: `${name}に同じIDが含まれています` };
    }
    ids.push(id);
  }
  return { ok: true, value: ids };
}

/**
 * 画像の幅・高さを検証する。
 *
 * @param value - 幅または高さの値
 * @returns 1 以上 {@link MAX_IMAGE_LONG_EDGE} 以下の整数なら true（ブラウザがこの長辺まで縮小してから送るため）
 */
function isImageDimension(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_IMAGE_LONG_EDGE
  );
}

/**
 * 保存する添付画像を検証し、Base64 を復号する（#6）。
 *
 * 形式はクライアントの申告を受け取らず、復号したバイト列の先頭で判定する（PNG / JPEG のみ）。
 * 上限を超える文字列は復号する前に弾く。
 *
 * @param value - `attachments` の値
 * @param maxCount - 枚数の上限（user は {@link MAX_IMAGES_PER_MESSAGE}、assistant は {@link MAX_TOOL_SCREENSHOTS_PER_MESSAGE}）
 * @returns 検証・復号済みの添付（未指定なら空配列）。配列でない・枚数超過・要素の形や ID・寸法の不正・ID の重複・Base64 の不正・上限超過・PNG / JPEG でないなら失敗
 */
function parseAttachments(
  value: unknown,
  maxCount: number
): ParseResult<AttachmentInput[]> {
  if (value == null) return { ok: true, value: [] };
  if (!Array.isArray(value)) {
    return { ok: false, error: 'attachmentsは配列で指定してください' };
  }
  if (value.length > maxCount) {
    return {
      ok: false,
      error: `画像は1メッセージにつき${maxCount}枚までです`,
    };
  }

  const attachments: AttachmentInput[] = [];
  for (const [index, entry] of value.entries()) {
    const label = `attachments[${index}]`;
    if (!isJsonObject(entry)) {
      return { ok: false, error: `${label}はオブジェクトで指定してください` };
    }
    const { id, data, width, height } = entry;
    if (typeof id !== 'string' || !isValidUUID(id)) {
      return { ok: false, error: `${label}.idはUUID形式で指定してください` };
    }
    if (attachments.some((attachment) => attachment.id === id)) {
      return { ok: false, error: 'attachmentsに同じIDが含まれています' };
    }
    if (!isImageDimension(width) || !isImageDimension(height)) {
      return {
        ok: false,
        error: `${label}のwidth・heightは1〜${MAX_IMAGE_LONG_EDGE}の整数で指定してください`,
      };
    }
    if (typeof data !== 'string') {
      return { ok: false, error: `${label}.dataは文字列で指定してください` };
    }
    if (base64DecodedLength(data) > MAX_IMAGE_BYTES) {
      return {
        ok: false,
        error: `画像は1枚${formatCount(MAX_IMAGE_BYTES / 1024 / 1024)}MB以内にしてください`,
      };
    }
    const bytes = decodeBase64(data);
    if (!bytes) {
      return { ok: false, error: `${label}.dataはBase64で指定してください` };
    }
    const mimeType = detectImageMimeType(bytes);
    if (!mimeType) {
      return { ok: false, error: '画像はPNGかJPEGで指定してください' };
    }
    attachments.push({ id, data: bytes, mimeType, width, height });
  }
  return { ok: true, value: attachments };
}

/**
 * 会話履歴を検証し、`role`・`content`・`imageIds` だけに詰め直す。
 *
 * クライアントが `tool_calls` などを混ぜても Ollama へは渡さない。
 * 各 `content` の上限は保存 API と同じため、DB から復元した履歴が弾かれることはない。
 *
 * @param value - `conversationHistory` の値
 * @returns 検証済みの履歴（未指定なら空配列）。配列でない・件数超過・要素が不正（assistant の `imageIds` を含む）なら失敗
 */
function parseConversationHistory(
  value: unknown
): ParseResult<ChatHistoryEntry[]> {
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

  const history: ChatHistoryEntry[] = [];
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
    const imageIds = parseImageIds(entry.imageIds, `${label}.imageIds`);
    if (!imageIds.ok) return imageIds;
    // 添付は user だけが持つ（保存 API が assistant の添付を受け付けない）
    if (role === 'assistant' && imageIds.value.length > 0) {
      return {
        ok: false,
        error: `${label}.imageIdsはuserのメッセージにだけ指定できます`,
      };
    }
    history.push({ role, content, imageIds: imageIds.value });
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

  const imageIds = parseImageIds(body.imageIds, 'imageIds');
  if (!imageIds.ok) return imageIds;

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
      imageIds: imageIds.value,
      conversationHistory: history.value,
      model: model.value,
      enableTools: enableTools ?? false,
      systemPrompt: systemPrompt.value,
    },
  };
}

/**
 * 会話の役割（システムプロンプト）を検証し、保存する形に整える。
 *
 * @param value - `systemPrompt` フィールドの値
 * @returns 前後の空白を除いた役割。未指定（`undefined` / `null`）・空白のみなら `null`（役割なし）。文字列でない・上限超過なら失敗
 */
function parseConversationSystemPrompt(
  value: unknown
): ParseResult<string | null> {
  const parsed = parseOptionalString(value, 'systemPrompt');
  if (!parsed.ok) return parsed;

  const trimmed = parsed.value?.trim() || null;
  if (trimmed && trimmed.length > MAX_CONVERSATION_SYSTEM_PROMPT_LENGTH) {
    return {
      ok: false,
      error: `systemPromptは${formatCount(MAX_CONVERSATION_SYSTEM_PROMPT_LENGTH)}文字以内で指定してください`,
    };
  }
  return { ok: true, value: trimmed };
}

/**
 * `POST /api/conversations` のボディを検証する。
 *
 * @param body - {@link readJsonBody} で読み取った値（空ボディは `{}`）
 * @returns 検証済みのボディ（`title` 未指定・空白のみなら既定タイトル、`systemPrompt` 未指定・空白のみなら `null`）。オブジェクトでない・`title`/`systemPrompt` が文字列でない・上限超過なら失敗
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

  const systemPrompt = parseConversationSystemPrompt(body.systemPrompt);
  if (!systemPrompt.ok) return systemPrompt;

  return {
    ok: true,
    value: { title: resolved, systemPrompt: systemPrompt.value },
  };
}

/**
 * `PATCH /api/conversations/[id]` のボディを検証する（会話の役割の変更。#10）。
 *
 * 変更できるのは役割だけ。`systemPrompt` キーの省略は「何も変えない」と「役割を外す」の
 * 区別が付かないため失敗にし、外すときは `null` か空文字を明示させる。
 *
 * @param body - {@link readJsonBody} で読み取った値
 * @returns 検証済みのボディ（`null`・空白のみなら役割を外す `null`）。オブジェクトでない・`systemPrompt` キーが無い・文字列/`null` でない・上限超過なら失敗
 */
export function parseUpdateConversationBody(
  body: unknown
): ParseResult<UpdateConversationBody> {
  if (!isJsonObject(body)) return { ok: false, error: NOT_OBJECT_ERROR };
  if (!('systemPrompt' in body)) {
    return {
      ok: false,
      error: 'systemPromptを指定してください（外す場合は null）',
    };
  }

  const systemPrompt = parseConversationSystemPrompt(body.systemPrompt);
  if (!systemPrompt.ok) return systemPrompt;

  return { ok: true, value: { systemPrompt: systemPrompt.value } };
}

/** `POST /api/agent/approvals/[id]` の検証済みボディ。 */
export type ApprovalBody = {
  /** 許可なら true、拒否なら false */
  approved: boolean;
};

/**
 * `POST /api/agent/approvals/[id]` のボディを検証する（ツールの実行前の承認。#148 Phase A2）。
 *
 * @param body - {@link readJsonBody} で読み取った値
 * @returns 検証済みのボディ。オブジェクトでない・`approved` が真偽値でなければ失敗
 */
export function parseApprovalBody(body: unknown): ParseResult<ApprovalBody> {
  if (!isJsonObject(body)) return { ok: false, error: NOT_OBJECT_ERROR };
  if (typeof body.approved !== 'boolean') {
    return {
      ok: false,
      error: 'approvedは true（許可）か false（拒否）で指定してください',
    };
  }
  return { ok: true, value: { approved: body.approved } };
}

/**
 * `POST /api/conversations/[id]/messages` のボディを検証する。
 *
 * `metadata` は指定されたのにオブジェクトでない場合、黙って捨てずに失敗にする。
 * `attachments` は、user は添付画像（#6。{@link MAX_IMAGES_PER_MESSAGE} 枚まで）、assistant はブラウザのツールが撮った画面
 * （#200。{@link MAX_TOOL_SCREENSHOTS_PER_MESSAGE} 枚まで）。
 *
 * @param body - {@link readJsonBody} で読み取った値
 * @returns 検証済みのボディ。オブジェクトでない・`id` が UUID 形式でない・`role`/`content` の欠落・型や role の不正・`metadata` が非オブジェクト・本文の上限超過・`attachments` の不正（role ごとの枚数の超過を含む）なら失敗
 */
export function parseSaveMessageBody(
  body: unknown
): ParseResult<SaveMessageBody> {
  if (!isJsonObject(body)) return { ok: false, error: NOT_OBJECT_ERROR };

  const { id, role, content, metadata, attachments } = body;
  if (id != null && (typeof id !== 'string' || !isValidUUID(id))) {
    return { ok: false, error: 'idはUUID形式で指定してください' };
  }
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

  const parsedAttachments = parseAttachments(
    attachments,
    role === 'user' ? MAX_IMAGES_PER_MESSAGE : MAX_TOOL_SCREENSHOTS_PER_MESSAGE
  );
  if (!parsedAttachments.ok) return parsedAttachments;

  return {
    ok: true,
    value: {
      id: id ?? undefined,
      role,
      content,
      metadata: isJsonObject(metadata) ? metadata : undefined,
      attachments: parsedAttachments.value,
    },
  };
}

/**
 * `PUT /api/conversations/[id]/messages/[messageId]` のボディを検証する。
 *
 * 置き換えられるのは assistant の応答だけのため、`role` は受け取らず、本文の上限も
 * assistant の上限（{@link MAX_ASSISTANT_MESSAGE_LENGTH}）を使う。`attachments` はブラウザのツールが撮った画面（#200）。
 *
 * @param body - {@link readJsonBody} で読み取った値
 * @returns 検証済みのボディ。オブジェクトでない・`content` が空または文字列でない・`metadata` が非オブジェクト・本文の上限超過・`attachments` の不正なら失敗
 */
export function parseReplaceMessageBody(
  body: unknown
): ParseResult<ReplaceMessageBody> {
  if (!isJsonObject(body)) return { ok: false, error: NOT_OBJECT_ERROR };

  const { content, metadata, attachments } = body;
  if (typeof content !== 'string' || !content) {
    return { ok: false, error: 'contentは空でない文字列で指定してください' };
  }
  if (metadata != null && !isJsonObject(metadata)) {
    return {
      ok: false,
      error: 'metadataはオブジェクト形式で指定してください',
    };
  }
  if (content.length > MAX_ASSISTANT_MESSAGE_LENGTH) {
    return {
      ok: false,
      error: `メッセージは${formatCount(MAX_ASSISTANT_MESSAGE_LENGTH)}文字以内で入力してください`,
    };
  }
  const parsedAttachments = parseAttachments(
    attachments,
    MAX_TOOL_SCREENSHOTS_PER_MESSAGE
  );
  if (!parsedAttachments.ok) return parsedAttachments;

  return {
    ok: true,
    value: {
      content,
      metadata: isJsonObject(metadata) ? metadata : undefined,
      attachments: parsedAttachments.value,
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

/**
 * `POST /api/diagrams/plantuml` のボディを検証する（#171）。
 *
 * @param body - {@link readJsonBody} で読み取った値
 * @returns 検証済みのボディ。オブジェクトでない・`source` が文字列でない・空白だけ・上限超過なら失敗
 */
export function parsePlantUmlBody(body: unknown): ParseResult<PlantUmlBody> {
  if (!isJsonObject(body)) return { ok: false, error: NOT_OBJECT_ERROR };

  const { source } = body;
  if (typeof source !== 'string') {
    return { ok: false, error: 'sourceは文字列で指定してください' };
  }
  if (!source.trim()) {
    return { ok: false, error: '図のソースが空です' };
  }
  if (source.length > MAX_DIAGRAM_SOURCE_LENGTH) {
    return {
      ok: false,
      error: `図のソースは${formatCount(MAX_DIAGRAM_SOURCE_LENGTH)}文字以内で指定してください`,
    };
  }
  return { ok: true, value: { source } };
}

/**
 * `POST /api/prompt-templates`・`PUT /api/prompt-templates/[id]` のボディを検証する（#28）。
 *
 * 作成と置き換えで同じ形（名前・ショートカット・本文をすべて送る）。ショートカットは小文字にしてから形を見る
 * （`/Translate` と `/translate` を別のものにしない）。重複の判定は DB の一意制約に任せる（route が 409 にする）。
 *
 * @param body - {@link readJsonBody} で読み取った値
 * @returns 検証済みのボディ。オブジェクトでない・文字列でない・名前が空か上限超過・ショートカットの形が不正・本文が空白だけか上限超過なら失敗
 */
export function parsePromptTemplateBody(
  body: unknown
): ParseResult<PromptTemplateBody> {
  if (!isJsonObject(body)) return { ok: false, error: NOT_OBJECT_ERROR };

  const { name, shortcut, content } = body;
  if (typeof name !== 'string') {
    return { ok: false, error: 'nameは文字列で指定してください' };
  }
  if (typeof shortcut !== 'string') {
    return { ok: false, error: 'shortcutは文字列で指定してください' };
  }
  if (typeof content !== 'string') {
    return { ok: false, error: 'contentは文字列で指定してください' };
  }

  const trimmedName = name.trim();
  if (!trimmedName) return { ok: false, error: '名前を入力してください' };
  if (trimmedName.length > MAX_PROMPT_TEMPLATE_NAME_LENGTH) {
    return {
      ok: false,
      error: `名前は${MAX_PROMPT_TEMPLATE_NAME_LENGTH}文字以内で入力してください`,
    };
  }

  const normalizedShortcut = shortcut.trim().toLowerCase();
  if (!normalizedShortcut) {
    return { ok: false, error: 'ショートカットを入力してください' };
  }
  if (!isValidPromptTemplateShortcut(normalizedShortcut)) {
    return {
      ok: false,
      error: `ショートカットは英小文字・数字・「-」・「_」の${MAX_PROMPT_TEMPLATE_SHORTCUT_LENGTH}文字以内で、英小文字か数字で始めてください`,
    };
  }

  if (!content.trim()) return { ok: false, error: '本文を入力してください' };
  if (content.length > MAX_MESSAGE_LENGTH) {
    return {
      ok: false,
      error: `本文は${formatCount(MAX_MESSAGE_LENGTH)}文字以内で入力してください`,
    };
  }

  return {
    ok: true,
    value: { name: trimmedName, shortcut: normalizedShortcut, content },
  };
}

/** `POST /api/conversations/[id]/fork` の検証済みボディ（#29）。 */
export type ForkConversationBody = {
  /** 分岐する応答（assistant のメッセージ）の ID */
  messageId: string;
};

/**
 * `POST /api/conversations/[id]/fork`（応答から会話を分岐する。#29）のボディを検証する。
 *
 * メッセージがその会話の応答か・存在するかは DB を読まないと分からないため、route が確かめる。
 *
 * @param body - {@link readJsonBody} で読み取った値
 * @returns 検証済みのボディ。オブジェクトでない・`messageId` が UUID の文字列でなければ失敗
 */
export function parseForkConversationBody(
  body: unknown
): ParseResult<ForkConversationBody> {
  if (!isJsonObject(body)) return { ok: false, error: NOT_OBJECT_ERROR };
  const { messageId } = body;
  if (typeof messageId !== 'string' || !isValidUUID(messageId)) {
    return { ok: false, error: '無効なメッセージIDです' };
  }
  return { ok: true, value: { messageId } };
}

/** `POST /api/bookmarks` の検証済みボディ（#30）。 */
export type CreateBookmarkBody = {
  /** ブックマークを付ける応答（assistant のメッセージ）の UUID */
  messageId: string;
};

/**
 * `POST /api/bookmarks`（応答にブックマークを付ける。#30）のボディを検証する。
 *
 * メッセージが応答か・存在するかは DB を読まないと分からないため、route が確かめる。
 *
 * @param body - {@link readJsonBody} で読み取った値
 * @returns 検証済みのボディ。オブジェクトでない・`messageId` が UUID の文字列でなければ失敗
 */
export function parseCreateBookmarkBody(
  body: unknown
): ParseResult<CreateBookmarkBody> {
  if (!isJsonObject(body)) return { ok: false, error: NOT_OBJECT_ERROR };
  const { messageId } = body;
  if (typeof messageId !== 'string' || !isValidUUID(messageId)) {
    return { ok: false, error: '無効なメッセージIDです' };
  }
  return { ok: true, value: { messageId } };
}

/** `PATCH /api/bookmarks/[id]` の検証済みボディ（#30）。 */
export type BookmarkNoteBody = {
  /** 前後の空白を除いたメモ。空（空白だけを含む）なら `null`（メモなし） */
  note: string | null;
};

/**
 * `PATCH /api/bookmarks/[id]`（ブックマークのメモの書き換え。#30）のボディを検証する。
 *
 * `note` は必須で、`null` を送るとメモを消す。空白だけのメモも `null` にする（一覧で「メモなし」と区別しないため）。
 *
 * @param body - {@link readJsonBody} で読み取った値
 * @returns 検証済みのボディ。オブジェクトでない・`note` が無い・文字列と `null` 以外・上限超過なら失敗
 */
export function parseBookmarkNoteBody(
  body: unknown
): ParseResult<BookmarkNoteBody> {
  if (!isJsonObject(body)) return { ok: false, error: NOT_OBJECT_ERROR };
  const { note } = body;
  if (note === null) return { ok: true, value: { note: null } };
  if (typeof note !== 'string') {
    return { ok: false, error: 'noteは文字列かnullで指定してください' };
  }
  const trimmed = note.trim();
  if (trimmed.length > MAX_BOOKMARK_NOTE_LENGTH) {
    return {
      ok: false,
      error: `メモは${MAX_BOOKMARK_NOTE_LENGTH}文字以内で入力してください`,
    };
  }
  return { ok: true, value: { note: trimmed || null } };
}
