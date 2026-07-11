import { Tool } from './types';

const MAX_RESULTS = 5;
const MAX_CHARS = 3000;
const SEARCH_TIMEOUT_MS = 10000;

// DuckDuckGo HTML API エンドポイント（API キー不要）
const DDG_URL = 'https://html.duckduckgo.com/html/';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// HTML から検索結果を抽出する（正規表現ベース、外部パーサー不要）
function parseSearchResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];

  // result__a クラスのリンクからタイトルと URL を抽出
  const linkPattern = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
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
  while ((m = snippetPattern.exec(html)) !== null && snippets.length < MAX_RESULTS) {
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
  return joined.length > MAX_CHARS ? joined.slice(0, MAX_CHARS) + '…（省略）' : joined;
}

async function fetchWithRetry(query: string): Promise<string> {
  const url = `${DDG_URL}?q=${encodeURIComponent(query)}&kl=jp-jp`;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible; LocalAIChatBot/1.0)',
    Accept: 'text/html',
  };

  const MAX_RETRIES = 2;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
      try {
        res = await fetch(url, { headers, redirect: 'follow', signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (e) {
      // ネットワークエラー → リトライ対象
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      throw new Error(`Web検索に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (res.status === 429) {
      // レートリミット → Exponential Backoff
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 2000));
        continue;
      }
      throw new Error('Web検索がレートリミットに達しました。しばらく待ってから再試行してください。');
    }

    if (res.status >= 500) {
      // サーバーエラー → リトライ対象
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      throw new Error(`Web検索サーバーエラー (HTTP ${res.status})`);
    }

    if (!res.ok) {
      // 4xx などはリトライしない
      throw new Error(`Web検索リクエスト失敗 (HTTP ${res.status})`);
    }

    return res.text();
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
  execute: async (args) => {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) return 'エラー: 検索クエリが空です';

    try {
      const html = await fetchWithRetry(query);
      const results = parseSearchResults(html);
      return formatResults(query, results);
    } catch (e) {
      return `エラー: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
};
