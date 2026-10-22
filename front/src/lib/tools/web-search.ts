import type { Tool } from './types';
import { BodyTooLargeError, discardBody, readBodyWithLimit } from './read-body';

const MAX_RESULTS = 5;
const MAX_CHARS = 3000;
// 1 回の試行（ヘッダー受信から本文の読了まで）の期限（ミリ秒）
const SEARCH_TIMEOUT_MS = 10000;
// 1 MiB: 検索結果ページの受信バイト数の上限。DuckDuckGo の結果 HTML は数十 KB のため十分な余裕を持たせた値
const MAX_INPUT_BYTES = 1024 * 1024;

// DuckDuckGo HTML API エンドポイント（API キー不要）
const DDG_URL = 'https://html.duckduckgo.com/html/';

// DuckDuckGo のボット判定の確認ページが返すステータス（2xx のため res.ok では弾けない）
const BOT_CHALLENGE_STATUS = 202;
// 確認ページの目印（確認用モーダル・画像選択フォーム・判定スクリプト）。検索結果のページには現れない
const BOT_CHALLENGE_PATTERN =
  /id="(?:anomaly-modal|challenge-form)"|anomaly\.js/;
// 確認ページを受けたときにモデルへ返す理由。同じ IP からは時間をおくまで拒否が続くため、
// 言い換えた検索の繰り返し（#151 では 1 回の応答で 17 回）を止める指示まで含める
const BOT_CHALLENGE_MESSAGE =
  'Web検索サービス（DuckDuckGo）に自動アクセスと判定され、検索を拒否されました。' +
  '時間をおくまでは、言い換えて検索し直しても結果は得られません。Web検索を使わずに回答してください。';

/**
 * 検索の応答が、検索結果ではなく DuckDuckGo のボット判定の確認ページかを判定する。
 *
 * 確認ページは HTTP 202 で返り、結果のリンク（`result__a`）を含まないため、
 * 判定しないと「0 件」と区別できない（#151）。ステータスが 200 でも本文に
 * 確認ページの目印があれば確認ページとみなす。
 *
 * @param status - 検索の応答の HTTP ステータス
 * @param html - 検索の応答の本文
 * @returns 確認ページなら `true`
 */
export function isBotChallenge(status: number, html: string): boolean {
  return status === BOT_CHALLENGE_STATUS || BOT_CHALLENGE_PATTERN.test(html);
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// HTML から検索結果を抽出する（正規表現ベース、外部パーサー不要）
function parseSearchResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];

  // result__a クラスのリンクからタイトルと URL を抽出
  const linkPattern =
    /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetPattern = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

  const links: { url: string; title: string }[] = [];
  let m: RegExpExecArray | null;

  while ((m = linkPattern.exec(html)) !== null && links.length < MAX_RESULTS) {
    const url = m[1].trim();
    const title = m[2].replace(/<[^>]+>/g, '').trim();
    if (url && title && url.startsWith('http')) {
      links.push({ url, title });
    }
  }

  const snippets: string[] = [];
  while (
    (m = snippetPattern.exec(html)) !== null &&
    snippets.length < MAX_RESULTS
  ) {
    snippets.push(m[1].replace(/<[^>]+>/g, '').trim());
  }

  for (let i = 0; i < links.length; i++) {
    results.push({
      title: links[i].title,
      url: links[i].url,
      snippet: snippets[i] ?? '',
    });
  }

  return results;
}

function formatResults(query: string, results: SearchResult[]): string {
  if (results.length === 0) {
    return `"${query}" の検索結果が見つかりませんでした。`;
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
  return joined.length > MAX_CHARS
    ? joined.slice(0, MAX_CHARS) + '…（省略）'
    : joined;
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

// signal はエージェントの全体タイムアウト。中断されたらリトライせず即座に失敗させる
async function fetchWithRetry(
  query: string,
  signal: AbortSignal
): Promise<string> {
  const url = `${DDG_URL}?q=${encodeURIComponent(query)}&kl=jp-jp`;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible; LocalAIChatBot/1.0)',
    Accept: 'text/html',
  };

  const MAX_RETRIES = 2;

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
        headers,
        redirect: 'follow',
        signal: attemptSignal,
      });
    } catch (e) {
      // 全体タイムアウトによる中断はリトライしない
      if (signal.aborted) throw e;
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

    if (!res.ok) {
      discardBody(res);
      // 4xx などはリトライしない
      throw new Error(`Web検索リクエスト失敗 (HTTP ${res.status})`);
    }

    let html: string;
    try {
      html = await readBodyWithLimit(res, MAX_INPUT_BYTES, attemptSignal);
    } catch (e) {
      // サイズ超過はリトライしても同じ結果になる
      if (e instanceof BodyTooLargeError) {
        throw new Error('検索結果ページが大きすぎます（1MB 超）');
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

    // 確認ページは同じ IP からは再試行しても変わらないため、リトライせずに失敗にする
    if (isBotChallenge(res.status, html)) {
      throw new Error(BOT_CHALLENGE_MESSAGE);
    }
    return html;
  }

  throw new Error('Web検索に失敗しました');
}

/**
 * Web を検索して関連ページのタイトル・URL・概要を返すエージェントツール。
 *
 * 引数 `query`（自然言語または検索キーワード）を受け取り、API キー不要の
 * DuckDuckGo HTML エンドポイントへ問い合わせる。ネットワークエラー・レート
 * リミット（429）・サーバーエラー（5xx）はリトライ（バックオフ）し、上位
 * 最大 5 件を整形して返す。結果は最大 3,000 文字で、超過分は省略する。
 * ボット判定の確認ページ（{@link isBotChallenge}）は 0 件ではなく失敗として返し、
 * リトライしない。
 * 各試行の期限は本文の読了まで有効で、受信は 1 MiB で打ち切る。呼び出し元の
 * `signal` が中断されるとリトライ待機中でも即座に処理を止める。
 * エラーはすべて `"エラー: ..."` 形式の文字列で返し、例外は投げない。
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
    if (!query) return 'エラー: 検索クエリが空です';

    try {
      const html = await fetchWithRetry(query, signal);
      const results = parseSearchResults(html);
      return formatResults(query, results);
    } catch (e) {
      return `エラー: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
};
