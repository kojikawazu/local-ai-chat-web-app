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
