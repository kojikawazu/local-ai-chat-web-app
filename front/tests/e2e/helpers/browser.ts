import path from 'path';

/**
 * ブラウザのツール（#149）の E2E で開かせる確認用のページを配るサーバーの設定。
 *
 * `playwright.config.ts`（サーバーの起動と、dev サーバーの `BROWSER_LOCAL_ORIGINS`）と `browser-tools.spec.ts`
 * （モデルに開かせる URL）が同じ値を使うため、ここを唯一の定義にする。
 */

/** 確認用のページを配るポート。dev サーバー（3000）・Docker のサービス（5499・8888・8889）と重ならない */
export const E2E_BROWSER_FIXTURE_PORT = 3101;

/** 確認用のページのオリジン。dev サーバーへ `BROWSER_LOCAL_ORIGINS` として渡す */
export const E2E_BROWSER_FIXTURE_ORIGIN = `http://127.0.0.1:${E2E_BROWSER_FIXTURE_PORT}`;

/** 確認用のページのフォルダ（`fixtures/browser/`） */
export const E2E_BROWSER_FIXTURE_DIR = path.join(
  __dirname,
  '..',
  'fixtures',
  'browser'
);

/** 確認用のページに JavaScript で描いている合言葉（静的な HTML には無い） */
export const E2E_BROWSER_PASSPHRASE = 'しろくま73';
