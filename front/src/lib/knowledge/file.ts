import { KNOWLEDGE_FILE_EXTENSIONS } from '@/constants/knowledge/file';
import {
  MAX_KNOWLEDGE_DOCUMENT_NAME_LENGTH,
  MAX_KNOWLEDGE_FILE_BYTES,
} from '@/lib/shared/validation';

/**
 * ドキュメントの種類（#17）。チャンクの分け方が変わる（Markdown は見出しで、テキストは空行で分ける）。
 */
export type KnowledgeFileKind = 'markdown' | 'text';

/**
 * 取り込むファイルを検証した結果（#17）。
 */
export type ParsedKnowledgeFile =
  | {
      ok: true;
      /** ドキュメントの名前（ファイル名。前後の空白を除いたもの） */
      name: string;
      /** 種類（拡張子で決まる） */
      kind: KnowledgeFileKind;
      /** 本文（BOM を外し、改行を `\n` にそろえた後） */
      content: string;
      /** 本文のバイト数（UTF-8） */
      size: number;
    }
  | {
      ok: false;
      /** 利用者へ見せる理由 */
      error: string;
    };

/** 制御文字（ファイル名に入れさせない。一覧の表示が崩れ、名前の一致も分かりにくくなるため） */
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

/** パスの区切り（ブラウザはファイル名だけを送るが、API を直接呼ぶとパスを付けられる） */
const PATH_SEPARATOR = /[/\\]/;

/**
 * ファイル名から種類を決める（#17）。
 *
 * @param name - ファイル名
 * @returns 取り込める拡張子なら種類。それ以外は `null`
 */
export function knowledgeFileKind(name: string): KnowledgeFileKind | null {
  const lower = name.toLowerCase();
  const extension = KNOWLEDGE_FILE_EXTENSIONS.find((ext) =>
    lower.endsWith(ext)
  );
  if (!extension) return null;
  return extension === '.txt' ? 'text' : 'markdown';
}

/**
 * 取り込むファイルを検証し、本文を取り出す（#17。`docs/28-rag.md`「取り込み」）。
 *
 * 中身で判定する（クライアントが申告する MIME タイプは使わない）。UTF-8 として読めないもの・NUL を含むものは
 * テキストではないとみなす。先頭の BOM を外し、改行（`\r\n`・`\r`）を `\n` にそろえる。
 *
 * @param name - ファイル名（パスを含まないもの）
 * @param bytes - ファイルの中身
 * @returns 検証を通れば名前・種類・本文・バイト数。通らなければ理由
 */
export function parseKnowledgeFile(
  name: string,
  bytes: Uint8Array
): ParsedKnowledgeFile {
  const trimmedName = name.trim();
  if (trimmedName === '') {
    return { ok: false, error: 'ファイル名がありません' };
  }
  if ([...trimmedName].length > MAX_KNOWLEDGE_DOCUMENT_NAME_LENGTH) {
    return {
      ok: false,
      error: `ファイル名は${MAX_KNOWLEDGE_DOCUMENT_NAME_LENGTH}文字までです`,
    };
  }
  if (CONTROL_CHARACTER.test(trimmedName) || PATH_SEPARATOR.test(trimmedName)) {
    return { ok: false, error: 'ファイル名に使えない文字があります' };
  }

  const kind = knowledgeFileKind(trimmedName);
  if (!kind) {
    return { ok: false, error: unsupportedExtensionError() };
  }
  if (bytes.byteLength > MAX_KNOWLEDGE_FILE_BYTES) {
    return { ok: false, error: tooLargeError() };
  }

  let decoded: string;
  try {
    // fatal: 不正なバイト列を置き換えずに失敗させる（画像などを文字化けのまま取り込まないため）。
    // 先頭の BOM は既定（ignoreBOM: false）で外れる
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, error: NOT_TEXT_ERROR };
  }
  if (decoded.includes('\0')) {
    return { ok: false, error: NOT_TEXT_ERROR };
  }

  const content = decoded.replace(/\r\n?/g, '\n');
  if (content.trim() === '') {
    return { ok: false, error: 'ファイルが空です' };
  }

  return {
    ok: true,
    name: trimmedName,
    kind,
    content,
    size: new TextEncoder().encode(content).byteLength,
  };
}

/**
 * ドキュメントの名前の並び順の比べ方（#17）。一覧の API と画面（取り込んだものを足すとき）で同じ順にする。
 *
 * DB の `ORDER BY` は照合順序（環境で変わる）に従うため使わず、ロケールに依らない符号の順で比べる。
 *
 * @param a - 名前
 * @param b - 名前
 * @returns `a` が前なら負、後なら正、同じなら 0
 */
export function compareKnowledgeNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** テキストのファイルでないときの理由 */
const NOT_TEXT_ERROR = 'UTF-8 のテキストのファイルではありません';

/**
 * 取り込めない拡張子のときの理由（API の 400 と画面の事前の確認で同じ文にする）。
 *
 * @returns 理由の文
 */
export function unsupportedExtensionError(): string {
  return `取り込めるのは ${KNOWLEDGE_FILE_EXTENSIONS.join('・')} のファイルです`;
}

/**
 * ファイルが大きすぎるときの理由（API の 413 と画面の事前の確認で同じ文にする）。
 *
 * @returns 理由の文
 */
export function tooLargeError(): string {
  return `ファイルは ${MAX_KNOWLEDGE_FILE_BYTES / 1024 / 1024} MB までです`;
}
