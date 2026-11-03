/**
 * 会話から覚えさせるメモ（#236。`docs/28-rag.md`「会話から覚えさせる（Phase D）」）の型。
 */

/**
 * メモの種類（D3）。並びは `save_memory` の引数の説明の順。
 *
 * - `user`: 利用者のこと（役割・持っている知識）
 * - `preference`: 好み・やり方
 * - `project`: 進めていること（目的・期限・決めたこと）
 * - `reference`: 参照先（URL・置き場所）
 * - `fact`: 事実・知識
 */
export const MEMORY_TYPES = [
  'user',
  'preference',
  'project',
  'reference',
  'fact',
] as const;

/** メモの種類（{@link MEMORY_TYPES} のどれか） */
export type MemoryType = (typeof MEMORY_TYPES)[number];

/** モデルから受け取り、検証したメモの中身（frontmatter の日付はアプリが付ける）。 */
export type MemoryInput = {
  /** メモの名前（英小文字・数字・`-`。ファイル名になる） */
  name: string;
  /** 1 行の説明 */
  description: string;
  /** 種類 */
  type: MemoryType;
  /** 本文（改行は `\n` にそろえ、末尾の空白を除いたもの） */
  content: string;
};
