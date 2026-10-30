import { defaultPort, hostKey } from './url-policy';

/** {@link parseLocalOrigins} の結果。 */
type LocalOriginList = {
  /** 開いてよい手元の開発サーバー（{@link hostKey} の形。重なりは 1 つにまとめる） */
  origins: string[];
  /** 知らせること（外した値・使わない部分） */
  warnings: string[];
};

/**
 * `BROWSER_LOCAL_ORIGINS` の値を、開いてよい手元の開発サーバーの一覧に分ける（#149。`docs/18-browser-tools.md`）。
 *
 * カンマで区切り、前後の空白と空の要素を捨てる。`http`・`https` の URL として読めないもの・ユーザー名の付いたものは外す。
 * パス・クエリが付いていたら、オリジンだけを使う（知らせる）。ポートの省略は既定のポート（80・443）として扱う。
 * 照合はホストとポートで行う（プロキシは HTTPS・WebSocket の通信のスキームを区別できないため）。
 *
 * @param raw - 環境変数の値。未設定なら `undefined`
 * @returns 開いてよいオリジンと、知らせること
 */
export function parseLocalOrigins(raw: string | undefined): LocalOriginList {
  const origins = new Set<string>();
  const warnings: string[] = [];
  for (const item of (raw ?? '').split(',')) {
    const value = item.trim();
    if (!value) continue;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      warnings.push(`"${value}" は URL として読めないため使いません`);
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      warnings.push(`"${value}" は http・https ではないため使いません`);
      continue;
    }
    if (url.username || url.password) {
      warnings.push(`"${value}" はユーザー名が付いているため使いません`);
      continue;
    }
    if (url.pathname !== '/' || url.search || url.hash) {
      warnings.push(
        `"${value}" のパス・クエリは使わず、オリジン（${url.origin}）だけを使います`
      );
    }
    origins.add(hostKey(url.hostname, defaultPort(url)));
  }
  return { origins: [...origins], warnings };
}

/**
 * ブラウザのツールを使うかを、環境変数 `BROWSER_ENABLED` から決める（#149）。
 *
 * `process.env.BROWSER_ENABLED` を読むのはこの関数だけ。
 *
 * @returns `true` と書かれていれば true（既定は使わない）
 */
export function isBrowserEnabled(): boolean {
  return process.env.BROWSER_ENABLED?.trim().toLowerCase() === 'true';
}

/** 起動後に 1 度だけ解釈した結果。`undefined` はまだ解釈していない */
let cachedOrigins: string[] | undefined;

/**
 * 開いてよい手元の開発サーバーを、環境変数 `BROWSER_LOCAL_ORIGINS` から解決する（#149）。
 *
 * 初めて呼んだときに 1 度だけ解釈する（変えたら開発サーバーを再起動する）。外した値は `console.warn` で知らせる。
 * `process.env.BROWSER_LOCAL_ORIGINS` を読むのはこの関数だけ。
 *
 * @returns 開いてよいオリジン（{@link hostKey} の形）。未設定なら空配列（手元のサーバーは開けない）
 */
export function getBrowserLocalOrigins(): string[] {
  if (cachedOrigins) return cachedOrigins;
  const { origins, warnings } = parseLocalOrigins(
    process.env.BROWSER_LOCAL_ORIGINS
  );
  for (const warning of warnings) {
    console.warn(`BROWSER_LOCAL_ORIGINS: ${warning}`);
  }
  cachedOrigins = origins;
  return cachedOrigins;
}
