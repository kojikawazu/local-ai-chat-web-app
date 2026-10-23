import type { Tool, ToolOutput } from './types';
import { toolError } from './output';
import { BodyTooLargeError, discardBody, readBodyWithLimit } from './read-body';

const MAX_RESULTS = 5;
const MAX_CHARS = 3000;
// 1 回の試行（ヘッダー受信から本文の読了まで）の期限（ミリ秒）
const SEARCH_TIMEOUT_MS = 10000;
// 1 MiB: 検索結果の受信バイト数の上限。SearXNG の JSON は 1 回の検索で数十 KB のため十分な余裕を持たせた値
const MAX_INPUT_BYTES = 1024 * 1024;
// ネットワークエラー・429・5xx を再試行する回数（初回を除く）
const MAX_RETRIES = 2;

// SearXNG の接続先の既定値。docker-compose.yml の searxng サービスの公開ポートと一致させる
const DEFAULT_SEARXNG_URL = 'http://localhost:8888';

/** 検索結果 1 件。モデルへ渡す文章に整形する前の形。 */
type SearchResult = {
  /** ページのタイトル */
  title: string;
  /** ページの URL（http / https のみ） */
  url: string;
  /** 検索エンジンが返した概要。無ければ空文字 */
  snippet: string;
};

/**
 * SearXNG の接続先を環境変数 `SEARXNG_URL` から解決する。
 *
 * 呼び出しのたびに読む（テストで差し替えられるようにし、モジュール読み込み時に固定しない）。
 *
 * @returns 接続先のベース URL。未設定・空なら {@link DEFAULT_SEARXNG_URL}
 */
function getSearxngUrl(): string {
  return process.env.SEARXNG_URL?.trim() || DEFAULT_SEARXNG_URL;
}

/**
 * 値が文字列ならそのまま、そうでなければ空文字を返す。
 *
 * @param value - SearXNG の応答から取り出した値（型を信用しない）
 * @returns 文字列の値、または空文字
 */
function stringOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * SearXNG の JSON 応答から、検索結果と応答しなかった検索エンジンを取り出す。
 *
 * 応答の型は信用せず、`results` の各要素はタイトルと http / https の URL を持つものだけを採る。
 * `unresponsive_engines` は `[エンジン名, 理由]` の配列。
 *
 * @param json - `JSON.parse` した応答
 * @returns 上位 {@link MAX_RESULTS} 件の結果と、応答しなかった検索エンジン名。応答の形が想定と違えば `null`
 */
function parseSearxngResponse(
  json: unknown
): { results: SearchResult[]; unresponsiveEngines: string[] } | null {
  if (typeof json !== 'object' || json === null) return null;
  // object であることは上で確かめた。各プロパティは unknown のまま受け、使う前に検証する
  const { results, unresponsive_engines: unresponsive } = json as Record<
    string,
    unknown
  >;
  if (!Array.isArray(results)) return null;

  const parsed: SearchResult[] = [];
  for (const item of results) {
    if (parsed.length >= MAX_RESULTS) break;
    if (typeof item !== 'object' || item === null) continue;
    // object であることは上で確かめた。各プロパティは stringOf で文字列か検証する
    const { title, url, content } = item as Record<string, unknown>;
    const titleText = stringOf(title);
    const urlText = stringOf(url);
    if (!titleText || !/^https?:\/\//.test(urlText)) continue;
    parsed.push({ title: titleText, url: urlText, snippet: stringOf(content) });
  }

  const unresponsiveEngines = Array.isArray(unresponsive)
    ? unresponsive
        .map((entry) => (Array.isArray(entry) ? stringOf(entry[0]) : ''))
        .filter(Boolean)
    : [];

  return { results: parsed, unresponsiveEngines };
}

/**
 * SearXNG の応答本文を、モデルへ返すツールの結果の文章にする。
 *
 * 結果があれば `[N] タイトル / URL / 概要` の一覧（UI の `WebSearchResult` がこの形を読む）。
 * 0 件のときは、検索エンジンが 1 つでも応答しなかったなら失敗として理由を返し、
 * すべて応答したうえでの 0 件だけを「見つかりませんでした」とする。0 件と失敗を
 * 区別しないと、モデルは言い換えた検索を繰り返す（#151）。
 *
 * 見出しの要約は件数（`5 件`）。すべて応答したうえでの 0 件は `isEmpty` にする（#150）。
 *
 * @param query - 検索クエリ（結果の見出しに使う）
 * @param body - SearXNG の応答本文（JSON 文字列）
 * @returns ツールの実行結果。文章は最大 {@link MAX_CHARS} 文字で、超過分は省略する。失敗は `isError: true` で、文章は `"エラー: ..."` で始まる
 */
export function formatSearchResponse(query: string, body: string): ToolOutput {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return toolError(
      'SearXNG の応答を解釈できませんでした（JSON ではありません）'
    );
  }
  const parsed = parseSearxngResponse(json);
  if (!parsed) {
    return toolError(
      'SearXNG の応答を解釈できませんでした（results がありません）'
    );
  }

  const { results, unresponsiveEngines } = parsed;
  if (results.length === 0) {
    if (unresponsiveEngines.length > 0) {
      return toolError(
        `"${query}" の検索で、検索エンジンが応答しませんでした（${unresponsiveEngines.join(', ')}）。しばらく時間をおいてから検索し直してください。`
      );
    }
    return {
      result: `"${query}" の検索結果が見つかりませんでした。`,
      isError: false,
      summary: '0 件',
      isEmpty: true,
    };
  }

  const lines = [`"${query}" の検索結果 (上位${results.length}件):\n`];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`[${i + 1}] ${r.title}`);
    lines.push(`    URL: ${r.url}`);
    if (r.snippet) lines.push(`    ${r.snippet}`);
    lines.push('');
  }

  const joined = lines.join('\n');
  return {
    result:
      joined.length > MAX_CHARS
        ? joined.slice(0, MAX_CHARS) + '…（省略）'
        : joined,
    isError: false,
    summary: `${results.length} 件`,
  };
}

// signal の中断で打ち切れる待機。リトライ待ちの間に全体タイムアウトが来ても即時に抜ける
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(signal.reason);
    };
    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * fetch の失敗が「接続を拒否された」（SearXNG が起動していない）ものかを判定する。
 *
 * Node の fetch（undici）は接続の失敗を `TypeError('fetch failed')` で投げ、
 * 原因のエラーの `code` に `ECONNREFUSED` を持たせる。
 *
 * @param error - fetch が投げた値
 * @returns 接続を拒否されたなら `true`
 */
function isConnectionRefused(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const { cause } = error;
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    cause.code === 'ECONNREFUSED'
  );
}

// signal はエージェントの全体タイムアウト。中断されたらリトライせず即座に失敗させる
async function fetchWithRetry(
  query: string,
  signal: AbortSignal
): Promise<string> {
  const baseUrl = getSearxngUrl();
  let url: URL;
  try {
    url = new URL('/search', baseUrl);
  } catch {
    throw new Error(`SEARXNG_URL が URL として不正です（${baseUrl}）`);
  }
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  // クエリの言語から自動で判定させる（日本語・英語のどちらのクエリも来るため）
  url.searchParams.set('language', 'auto');

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    signal.throwIfAborted();
    // 試行ごとの期限は本文の読了まで有効にし、全体タイムアウトの中断も合流させる
    const attemptSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    ]);

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: attemptSignal,
      });
    } catch (e) {
      // 全体タイムアウトによる中断はリトライしない
      if (signal.aborted) throw e;
      // 起動していないなら、再試行しても変わらない
      if (isConnectionRefused(e)) {
        throw new Error(
          `SearXNG（${baseUrl}）に接続できません。プロジェクトのルートで \`docker compose up -d\` を実行して起動してください。起動するまで、検索し直しても結果は得られません。`
        );
      }
      // ネットワークエラー・試行の期限切れ → リトライ対象
      if (attempt < MAX_RETRIES) {
        await sleep(1000, signal);
        continue;
      }
      throw new Error(
        `Web検索に失敗しました: ${e instanceof Error ? e.message : String(e)}`
      );
    }

    if (res.status === 429) {
      discardBody(res);
      // レートリミット → Exponential Backoff
      if (attempt < MAX_RETRIES) {
        await sleep((attempt + 1) * 2000, signal);
        continue;
      }
      throw new Error(
        'Web検索がレートリミットに達しました。しばらく待ってから再試行してください。'
      );
    }

    if (res.status >= 500) {
      discardBody(res);
      // サーバーエラー → リトライ対象
      if (attempt < MAX_RETRIES) {
        await sleep(1000, signal);
        continue;
      }
      throw new Error(`Web検索サーバーエラー (HTTP ${res.status})`);
    }

    if (res.status === 403) {
      discardBody(res);
      // 設定の誤りのため、リトライしても同じ結果になる
      throw new Error(
        'SearXNG が JSON の応答を返しません（HTTP 403）。searxng/settings.yml の search.formats に json があるか確認してください。'
      );
    }

    if (!res.ok) {
      discardBody(res);
      // 4xx などはリトライしない
      throw new Error(`Web検索リクエスト失敗 (HTTP ${res.status})`);
    }

    try {
      return await readBodyWithLimit(res, MAX_INPUT_BYTES, attemptSignal);
    } catch (e) {
      // サイズ超過はリトライしても同じ結果になる
      if (e instanceof BodyTooLargeError) {
        throw new Error('検索結果が大きすぎます（1MB 超）');
      }
      if (signal.aborted) throw e;
      // 本文受信中のネットワークエラー・試行の期限切れ → リトライ対象
      if (attempt < MAX_RETRIES) {
        await sleep(1000, signal);
        continue;
      }
      throw new Error(
        `Web検索に失敗しました: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  throw new Error('Web検索に失敗しました');
}

/**
 * Web を検索して関連ページのタイトル・URL・概要を返すエージェントツール。
 *
 * 引数 `query`（自然言語または検索キーワード）を受け取り、ローカルの SearXNG
 * （`SEARXNG_URL`、既定 `http://localhost:8888`。docker-compose.yml で起動する）の
 * JSON API へ問い合わせる。SearXNG は複数の検索エンジンに代わりに問い合わせるため、
 * 1 つの検索エンジンがブロックされても結果を返せる（#151）。ネットワークエラー・
 * レートリミット（429）・サーバーエラー（5xx）はリトライ（バックオフ）し、上位
 * 最大 5 件を整形して返す（{@link formatSearchResponse}）。SearXNG が起動していない・
 * JSON の API が無効（403）の場合はリトライせず、直し方を含むエラーを返す。
 * 各試行の期限は本文の読了まで有効で、受信は 1 MiB で打ち切る。呼び出し元の
 * `signal` が中断されるとリトライ待機中でも即座に処理を止める。
 * エラーはすべて `isError: true`（文章は `"エラー: ..."` 形式）で返し、例外は投げない。
 */
export const webSearchTool: Tool = {
  definition: {
    name: 'web_search',
    description:
      'Web を検索してキーワードに関連するページのタイトル・URL・概要を返す。最新情報や外部の情報が必要な場合に使用する。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '検索クエリ（自然言語または検索キーワード）',
        },
      },
      required: ['query'],
    },
  },
  execute: async (args, signal) => {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) return toolError('検索クエリが空です');

    try {
      const body = await fetchWithRetry(query, signal);
      return formatSearchResponse(query, body);
    } catch (e) {
      return toolError(e instanceof Error ? e.message : String(e));
    }
  },
};
