import type { Message } from '@/types/chat/message';
import type { Conversation } from '@/types/conversation/conversation';
import { getRoleLabel } from '@/lib/chat/system-prompt';
import { withoutScreenshotData } from '@/lib/chat/tool-screenshots';

/**
 * 応答・会話の書き出し（#12）。保存するファイルの名前・中身・種類を組み立てる。
 *
 * ブラウザでの保存（`lib/shared/download.ts`）とは分け、ここは純粋な関数だけにする（UT で形を確かめるため）。
 * 日時はすべてローカル時刻で書く（ファイル名・本文を読むのは書き出した本人のため）。
 */

/** 会話全体の書き出しの形式 */
export type ConversationExportFormat = 'markdown' | 'json';

/** 保存する 1 ファイル */
export type ExportFile = {
  /** ファイル名（拡張子を含む） */
  fileName: string;
  /** ファイルの中身 */
  content: string;
  /** `Blob` の種類（MIME タイプ） */
  mimeType: string;
};

const MARKDOWN_MIME = 'text/markdown;charset=utf-8';
const JSON_MIME = 'application/json;charset=utf-8';

/**
 * JSON の形の版。形を変えたら上げる（読み込む側が版で判別できるように）。
 * 2: メッセージに添付画像の情報（`images`）を足した（#6）
 */
const JSON_EXPORT_VERSION = 2;

/** ファイル名に使うタイトルの最大文字数（コードポイント単位）。長すぎる名前は OS・ブラウザで切られるため */
const MAX_FILE_TITLE_LENGTH = 50;

/** タイトルが空のときのファイル名・見出し */
const FALLBACK_TITLE = '会話';

/**
 * ファイル名に使えない文字。Windows・macOS で使えない記号と、制御文字（改行・タブ等）。
 */
const UNSAFE_FILE_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

const ROLE_HEADINGS: Record<Message['role'], string> = {
  user: 'ユーザー',
  assistant: 'アシスタント',
};

/**
 * 数値を 2 桁の 0 埋めにする。
 *
 * @param n - 0〜99 の数値
 * @returns 2 桁の文字列
 */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * 日時を `YYYY-MM-DD` と `HH:mm` に分けてローカル時刻で書く。
 *
 * @param date - 書く日時
 * @returns 日付と時刻
 */
function formatParts(date: Date): { day: string; time: string } {
  return {
    day: `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
    time: `${pad2(date.getHours())}:${pad2(date.getMinutes())}`,
  };
}

/**
 * 日時を `YYYY-MM-DD HH:mm`（ローカル時刻）で書く。
 *
 * @param date - 書く日時
 * @returns 本文に書く日時
 */
function formatDateTime(date: Date): string {
  const { day, time } = formatParts(date);
  return `${day} ${time}`;
}

/**
 * タイトルを 1 行に整える（改行・連続する空白を 1 つの空白にし、前後の空白を除く）。
 *
 * @param title - 会話のタイトル
 * @returns 整えたタイトル。空なら {@link FALLBACK_TITLE}
 */
function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim() || FALLBACK_TITLE;
}

/**
 * 会話のタイトルと日時から、保存するファイル名を作る。
 *
 * 使えない文字は `_` に置き換え、前後の空白・ピリオドを除き（Windows は末尾のピリオドを消す）、
 * {@link MAX_FILE_TITLE_LENGTH} 文字までに切り詰める。何も残らなければ {@link FALLBACK_TITLE} にする。
 *
 * @param title - 会話のタイトル
 * @param date - ファイル名に入れる日時（ローカル時刻の `YYYY-MM-DD_HHmm` にする）
 * @param extension - 拡張子（ピリオドを含まない。`md`・`json`）
 * @returns `<タイトル>_<YYYY-MM-DD_HHmm>.<拡張子>`
 */
export function buildExportFileName(
  title: string,
  date: Date,
  extension: string
): string {
  const replaced = title
    .replace(UNSAFE_FILE_NAME_CHARS, '_')
    .replace(/\s+/g, ' ')
    .trim();
  // 絵文字などのサロゲートペアを途中で切らないよう、コードポイント単位で数える
  const truncated = Array.from(replaced)
    .slice(0, MAX_FILE_TITLE_LENGTH)
    .join('')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  const { day, time } = formatParts(date);
  return `${truncated || FALLBACK_TITLE}_${day}_${time.replace(':', '')}.${extension}`;
}

/**
 * 応答 1 件を Markdown のファイルにする（19-2）。中身は本文の原文だけ（「コピー」と同じ）。
 *
 * @param message - 書き出す応答
 * @param conversationTitle - ファイル名に使う会話のタイトル（会話が一覧に無い間は空でよい）
 * @returns 保存するファイル。ファイル名の日時は応答の作成日時
 */
export function buildMessageExport(
  message: Pick<Message, 'content' | 'createdAt'>,
  conversationTitle: string
): ExportFile {
  return {
    fileName: buildExportFileName(conversationTitle, message.createdAt, 'md'),
    content: message.content,
    mimeType: MARKDOWN_MIME,
  };
}

/**
 * 会話全体を Markdown にする。先頭にタイトル・書き出した日時・会話の役割を置き、
 * メッセージを「## ユーザー（日時）」「## アシスタント（日時）」の見出しで `---` 区切りに並べる。
 * 思考過程・ツールの結果は入れない（読み物として扱うため。全部が要るときは JSON を使う）。
 * 添付画像は埋め込まず、本文の前に `[画像 n 枚]` と書く（#6）。
 *
 * @param conversation - 書き出す会話
 * @param messages - 表示中のメッセージ（古い順）
 * @param exportedAt - 書き出した日時
 * @returns Markdown の本文（末尾は改行 1 つ）
 */
function formatConversationMarkdown(
  conversation: Conversation,
  messages: Message[],
  exportedAt: Date
): string {
  const lines = [
    `# ${normalizeTitle(conversation.title)}`,
    '',
    `- 書き出した日時: ${formatDateTime(exportedAt)}`,
  ];
  const role = conversation.systemPrompt?.trim();
  if (role) {
    lines.push(`- 会話の役割: ${getRoleLabel(role)}`, '');
    // 役割の本文は複数行になりうるため、各行を引用にする
    lines.push(...role.split('\n').map((line) => (line ? `> ${line}` : '>')));
  }

  for (const message of messages) {
    lines.push(
      '',
      '---',
      '',
      `## ${ROLE_HEADINGS[message.role]}（${formatDateTime(message.createdAt)}）`,
      ''
    );
    if (message.images && message.images.length > 0) {
      lines.push(`[画像 ${message.images.length} 枚]`, '');
    }
    lines.push(message.content);
    if (message.metadata?.interrupted) {
      lines.push('', '_（生成を中断した応答）_');
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * 会話全体を JSON にする（バックアップ用。データを省かない）。
 *
 * 画面の側だけで持つ保存失敗の状態（`saveState`）は入れない（API・DB には無い値のため）。
 * 添付画像は中身を入れず、ID と大きさだけを `images` に入れる（#6。中身は `GET /api/attachments/[id]` で取れる）。
 * ブラウザのツールの画面（#200）も、生成した直後の画面の記録が持つ中身を外し、保存したときと同じ形（ID と大きさ）にする。
 *
 * @param conversation - 書き出す会話
 * @param messages - 表示中のメッセージ（古い順）
 * @param exportedAt - 書き出した日時
 * @returns 2 文字の字下げの JSON（末尾は改行 1 つ）
 */
function formatConversationJson(
  conversation: Conversation,
  messages: Message[],
  exportedAt: Date
): string {
  const data = {
    version: JSON_EXPORT_VERSION,
    exportedAt: exportedAt.toISOString(),
    conversation: {
      id: conversation.id,
      title: conversation.title,
      systemPrompt: conversation.systemPrompt,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    },
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      metadata: message.metadata?.toolCalls
        ? {
            ...message.metadata,
            toolCalls: withoutScreenshotData(message.metadata.toolCalls),
          }
        : (message.metadata ?? null),
      images: (message.images ?? []).map(({ id, width, height }) => ({
        id,
        width,
        height,
      })),
    })),
  };
  return `${JSON.stringify(data, null, 2)}\n`;
}

/**
 * 会話全体を、選んだ形式のファイルにする（19-3）。
 *
 * @param conversation - 書き出す会話
 * @param messages - 表示中のメッセージ（古い順）
 * @param format - 形式（Markdown か JSON）
 * @param exportedAt - 書き出した日時。ファイル名にも使う
 * @returns 保存するファイル
 */
export function buildConversationExport(
  conversation: Conversation,
  messages: Message[],
  format: ConversationExportFormat,
  exportedAt: Date
): ExportFile {
  if (format === 'json') {
    return {
      fileName: buildExportFileName(conversation.title, exportedAt, 'json'),
      content: formatConversationJson(conversation, messages, exportedAt),
      mimeType: JSON_MIME,
    };
  }
  return {
    fileName: buildExportFileName(conversation.title, exportedAt, 'md'),
    content: formatConversationMarkdown(conversation, messages, exportedAt),
    mimeType: MARKDOWN_MIME,
  };
}
