import { mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * E2E の dev サーバーに `LOCAL_FILE_ROOTS` として渡すフォルダ（#148）。
 *
 * `playwright.config.ts`（dev サーバーへ渡す）と `local-files.spec.ts`（モデルに読ませるパス）が同じ値を使うため、
 * ここを唯一の定義にする。中身は E2E 用の小さなファイルだけで、秘匿ファイルは置かない。
 */
export const E2E_LOCAL_FILES_DIR = path.join(
  __dirname,
  '..',
  'fixtures',
  'local-files'
);

/**
 * E2E の dev サーバーに `LOCAL_FILE_WRITE_ROOTS` として渡す、書き込みを試すフォルダ（#148 Phase A2）。
 *
 * リポジトリの中（fixtures）を書き換えないよう、OS の一時フォルダに置く。書き込みのフォルダは読み取りのフォルダの中に
 * ある必要があるため、`LOCAL_FILE_ROOTS` にも足して渡す。dev サーバーは起動時にフォルダの実在を確かめるため、
 * 読み込んだ時点で作っておく（`playwright.config.ts` が起動より先に読み込む）。
 */
export const E2E_WRITE_DIR = path.join(tmpdir(), 'nordic-chat-e2e-write');
mkdirSync(E2E_WRITE_DIR, { recursive: true });
