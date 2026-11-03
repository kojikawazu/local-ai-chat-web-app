import { MEMORY_TYPES } from '@/types/knowledge/memory';
import type { MemoryInput, MemoryType } from '@/types/knowledge/memory';

/**
 * 会話から覚えさせるメモ（#236。`docs/28-rag.md`「会話から覚えさせる（Phase D）」）の純ロジック。
 *
 * モデルから受けた値の検証、ファイルの中身（frontmatter + 本文）の組み立て、鍵・トークンらしい文字列の判定を行う。
 * ファイル・git・DB には触れない（`lib/server/knowledge-memory.ts` が担う）。
 */

/** メモを置くフォルダ（保管庫の中の相対パス）。アプリはこの中にだけ書く */
export const MEMORY_DIR = 'memories';

/** メモの名前の最小の文字数（`a`・`ab` のような意味の分からない名前を避ける） */
export const MIN_MEMORY_NAME_LENGTH = 3;

/** メモの名前の最大の文字数（ファイル名・出典の名前として読める長さ） */
export const MAX_MEMORY_NAME_LENGTH = 60;

/** 説明の最大の文字数（1 行で読める長さ） */
export const MAX_MEMORY_DESCRIPTION_CHARS = 200;

/** 本文の最大の文字数。1 件 1 つのことを覚える大きさ（長い資料は保管庫に手で置く） */
export const MAX_MEMORY_CONTENT_CHARS = 10_000;

/** 名前の形: 英小文字・数字を `-` 1 つでつなぐ（先頭・末尾の `-`、`--` は使わない） */
const MEMORY_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 日付の形（`YYYY-MM-DD`） */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 1 行の説明に入れない文字（改行を含む C0 制御文字と DEL） */
const LINE_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;

/** 本文に入れない文字（改行・タブ以外の制御文字） */
const CONTENT_CONTROL_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/**
 * 鍵・トークンらしい文字列（D8）。Secret scan・ローカルのファイルのツールと同じく、形で明らかなものだけを見る。
 * 誤って止めにくいよう、各サービスの決まった接頭辞と長さで判定する。
 */
const SECRET_PATTERNS: { label: string; pattern: RegExp }[] = [
  { label: 'OpenAI の API キー', pattern: /\bsk-[A-Za-z0-9_-]{20,}/ },
  {
    label: 'GitHub のトークン',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/,
  },
  { label: 'AWS のアクセスキー', pattern: /\bAKIA[A-Z0-9]{16}\b/ },
  { label: 'Slack のトークン', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { label: 'Google の API キー', pattern: /\bAIza[0-9A-Za-z_-]{35}/ },
  {
    label: '秘密鍵',
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
  },
];

/** {@link validateMemoryInput} の結果。 */
export type MemoryInputResult =
  { ok: true; value: MemoryInput } | { ok: false; error: string };

/**
 * 鍵・トークンらしい文字列を探す（D8）。
 *
 * @param text - 調べる文字列
 * @returns 見つけた種類の名前。無ければ `null`
 */
export function findSecretLike(text: string): string | null {
  return (
    SECRET_PATTERNS.find(({ pattern }) => pattern.test(text))?.label ?? null
  );
}

/**
 * 値が {@link MEMORY_TYPES} のどれかかを確かめる。
 *
 * @param value - 調べる値
 * @returns メモの種類なら true
 */
function isMemoryType(value: unknown): value is MemoryType {
  return (
    typeof value === 'string' &&
    (MEMORY_TYPES as readonly string[]).includes(value)
  );
}

/**
 * メモの名前を確かめる（D4）。
 *
 * @param value - 名前
 * @returns 正しければ `null`、正しくなければ理由
 */
export function memoryNameError(value: unknown): string | null {
  const rule = `英小文字・数字を - でつないだ ${MIN_MEMORY_NAME_LENGTH}〜${MAX_MEMORY_NAME_LENGTH} 字（例: coffee-preference）`;
  if (typeof value !== 'string' || value.length === 0) {
    return `name にメモの名前を指定してください（${rule}）`;
  }
  if (
    value.length < MIN_MEMORY_NAME_LENGTH ||
    value.length > MAX_MEMORY_NAME_LENGTH ||
    !MEMORY_NAME_PATTERN.test(value)
  ) {
    return `name「${value}」は使えません。${rule}にしてください`;
  }
  return null;
}

/**
 * `save_memory` の引数を確かめ、保存する形にそろえる（D3・D4・D8）。
 *
 * 説明は前後の空白を除いた 1 行、本文は改行を `\n` にそろえて前後の空白行を除く。
 * 説明・本文に鍵・トークンらしい文字列があれば断る。
 *
 * @param args - モデルから受けた引数
 * @returns そろえたメモ、または理由（モデルへ返す文）
 */
export function validateMemoryInput(
  args: Record<string, unknown>
): MemoryInputResult {
  const nameError = memoryNameError(args.name);
  if (nameError) return { ok: false, error: nameError };
  const name = args.name as string; // memoryNameError が文字列であることを確かめた

  if (typeof args.description !== 'string' || !args.description.trim()) {
    return {
      ok: false,
      error: 'description にメモの 1 行の説明を指定してください',
    };
  }
  const description = args.description.trim();
  if (LINE_CONTROL_PATTERN.test(description)) {
    return {
      ok: false,
      error: 'description は改行を含まない 1 行にしてください',
    };
  }
  if (description.length > MAX_MEMORY_DESCRIPTION_CHARS) {
    return {
      ok: false,
      error: `description が長すぎます（${description.length} 字。上限 ${MAX_MEMORY_DESCRIPTION_CHARS} 字）`,
    };
  }

  if (!isMemoryType(args.type)) {
    return {
      ok: false,
      error: `type は ${MEMORY_TYPES.join(' / ')} のどれかにしてください`,
    };
  }

  if (typeof args.content !== 'string' || !args.content.trim()) {
    return { ok: false, error: 'content に覚える内容を指定してください' };
  }
  const content = args.content.replace(/\r\n?/g, '\n').trim();
  if (CONTENT_CONTROL_PATTERN.test(content)) {
    return { ok: false, error: 'content に制御文字が含まれています' };
  }
  if (content.length > MAX_MEMORY_CONTENT_CHARS) {
    return {
      ok: false,
      error: `content が長すぎます（${content.length.toLocaleString()} 字。上限 ${MAX_MEMORY_CONTENT_CHARS.toLocaleString()} 字）。1 件に 1 つのことを書いてください`,
    };
  }

  const secret = findSecretLike(`${description}\n${content}`);
  if (secret) {
    return {
      ok: false,
      error: `メモに${secret}らしい文字列が含まれるため保存しません（git の履歴に残るため）。その部分を除いてください`,
    };
  }

  return { ok: true, value: { name, description, type: args.type, content } };
}

/**
 * メモの保管庫の中のパスを返す。
 *
 * @param name - 検証済みのメモの名前
 * @returns `memories/<名前>.md`
 */
export function memoryRelativePath(name: string): string {
  return `${MEMORY_DIR}/${name}.md`;
}

/**
 * 日付を `YYYY-MM-DD` にする（サーバーの地域の日付）。
 *
 * @param date - 日時
 * @returns `YYYY-MM-DD`
 */
export function formatMemoryDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * メモのファイルの中身を組み立てる（D3）。
 *
 * frontmatter はアプリが書く。説明は JSON の文字列として書く（JSON の文字列は YAML のダブルクォートの文字列として
 * 読めるため、`:`・`#`・引用符を含んでも崩れない）。名前・種類・日付は検証済みで、引用せずに書ける。
 *
 * @param memory - 検証済みのメモ
 * @param dates - 作った日・変えた日（`YYYY-MM-DD`）
 * @returns ファイルの中身（末尾は改行 1 つ）
 */
export function buildMemoryFile(
  memory: MemoryInput,
  dates: { created: string; updated: string }
): string {
  return [
    '---',
    `name: ${memory.name}`,
    `description: ${JSON.stringify(memory.description)}`,
    `type: ${memory.type}`,
    `created: ${dates.created}`,
    `updated: ${dates.updated}`,
    '---',
    '',
    memory.content,
    '',
  ].join('\n');
}

/**
 * 今のメモのファイルから、作った日・変えた日を読む（上書きで作った日を保つため）。
 *
 * 先頭の frontmatter（最初の `---` から次の `---` まで）の `created:`・`updated:` の行だけを見る。
 * 手で書き換えて形が崩れていれば、その日付は `null` にする。
 *
 * @param text - 今のファイルの中身
 * @returns 作った日・変えた日（`YYYY-MM-DD`）。読めなければ `null`
 */
export function readMemoryDates(text: string): {
  created: string | null;
  updated: string | null;
} {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const dates: { created: string | null; updated: string | null } = {
    created: null,
    updated: null,
  };
  if (lines[0] !== '---') return dates;
  for (const line of lines.slice(1)) {
    if (line === '---') break;
    const match = /^(created|updated):\s*(\S+)\s*$/.exec(line);
    if (match && DATE_PATTERN.test(match[2])) {
      dates[match[1] as 'created' | 'updated'] = match[2]; // 正規表現の 1 つ目の組は 2 つの名前のどちらか
    }
  }
  return dates;
}
