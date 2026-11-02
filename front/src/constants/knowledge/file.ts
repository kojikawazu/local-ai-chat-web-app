/**
 * 取り込めるドキュメントのファイルの拡張子（小文字。#17）。
 *
 * 画面のファイルの選択（`accept`）と、API の検証の両方で使う。中身がテキストかは別に確かめる（`lib/knowledge/file.ts`）。
 * `.md`・`.markdown` は見出しで分け、`.txt` は空行で分ける。
 */
export const KNOWLEDGE_FILE_EXTENSIONS = ['.md', '.markdown', '.txt'] as const;
