import type { Tool, ToolOutput } from './types';
import { toolError } from './output';
import { checkSsrf } from './network-guard';
import {
  BodyTooLargeError,
  discardBody,
  isTimeoutError,
  readBodyWithLimit,
} from './read-body';

const MAX_CHARS = 5000;
// 2 MiB: 受信バイト数の上限（メモリ枯渇防止）。本文はこれを超えた時点で受信を打ち切る
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
// ヘッダー受信から本文の読了までを含めた 1 回の取得の期限（ミリ秒）
const FETCH_TIMEOUT_MS = 15000;
const TIMEOUT_REASON = `URL の取得がタイムアウトしました（${FETCH_TIMEOUT_MS / 1000}秒）`;
const TOO_LARGE_REASON = 'ページが大きすぎます（2MB 超）。';

// HTML タグを除去してプレーンテキストを抽出する
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '') // script ブロック除去
    .replace(/<style[\s\S]*?<\/style>/gi, '') // style ブロック除去
    .replace(/<!--[\s\S]*?-->/g, '') // コメント除去
    .replace(/<[^>]+>/g, ' ') // タグ除去
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ') // 連続空白を 1 つに
    .trim();
}

/**
 * 取得したページのテキストを、モデルへ返すツールの結果にする。
 *
 * {@link MAX_CHARS} 文字を超える分は省略する。見出しの要約は文字数で、省略したときは
 * 元の文字数と省略した旨を出す。テキストが無ければ `isEmpty` にする（#150）。
 *
 * @param text - HTML のタグを除いた（またはプレーンテキストの）本文
 * @returns ツールの実行結果
 */
export function formatFetchedText(text: string): ToolOutput {
  if (!text) {
    return {
      result: '（ページにテキストコンテンツが見つかりませんでした）',
      isError: false,
      summary: '本文なし',
      isEmpty: true,
    };
  }
  const length = text.length.toLocaleString('ja-JP');
  if (text.length > MAX_CHARS) {
    return {
      result: text.slice(0, MAX_CHARS) + '\n\n…（5,000文字を超えたため省略）',
      isError: false,
      summary: `${length} 文字（${MAX_CHARS.toLocaleString('ja-JP')} 文字に省略）`,
    };
  }
  return { result: text, isError: false, summary: `${length} 文字` };
}

/**
 * 指定 URL のページ内容を取得してテキストで返すエージェントツール。
 *
 * 引数 `url`（http:// または https:// のみ）を受け取り、SSRF 対策として
 * 名前解決後の IP がプライベート・特殊アドレス範囲でないことを検証したうえで
 * fetch する。リダイレクトは禁止、`text/html` または `text/plain` のみ対応。
 * タイムアウトはヘッダー受信から本文の読了までを覆い、本文は受信バイト数が
 * 2 MiB を超えた時点で打ち切る。呼び出し元の `signal` が中断された場合も
 * fetch と本文読み取りを止める。HTML はタグを除去したプレーンテキスト化し、
 * 5,000 文字を超える場合は末尾を省略する（{@link formatFetchedText}）。エラーはすべて
 * `isError: true`（文章は `"エラー: ..."` 形式）で返し、例外は投げない。
 */
export const urlFetchTool: Tool = {
  // 引数（検索語・URL）が外へ出る。ローカルのファイルを読んだ後は止める（#148）
  access: 'network',
  definition: {
    name: 'url_fetch',
    description:
      '指定した URL のページ内容を取得してテキストとして返す。Web ページの詳細を調べる場合や、web_search で見つけた URL の内容を確認する場合に使用する。',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '取得する URL（http:// または https:// で始まること）',
        },
      },
      required: ['url'],
    },
  },
  execute: async (args, signal) => {
    const url = typeof args.url === 'string' ? args.url.trim() : '';
    if (!url) return toolError('URL が空です');

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return toolError('URL の形式が正しくありません');
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return toolError(
        'http:// または https:// で始まる URL のみ対応しています'
      );
    }

    // SSRF チェック
    try {
      await checkSsrf(parsedUrl.hostname);
    } catch (e) {
      return toolError(e instanceof Error ? e.message : String(e));
    }

    // ヘッダー受信だけでなく本文の読了までを 1 つの期限で覆い、エージェント側の中断も合流させる
    const fetchSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(FETCH_TIMEOUT_MS),
    ]);

    // fetch（リダイレクト禁止）
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: 'error',
        signal: fetchSignal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LocalAIChatBot/1.0)',
        },
      });
    } catch (e) {
      if (isTimeoutError(e)) return toolError(TIMEOUT_REASON);
      // redirect: 'error' 時のリダイレクト検出: TypeError かつ message または cause に 'redirect' を含む
      // undici は 'fetch failed' という TypeError を投げ、実際の原因を e.cause に格納する場合がある
      if (e instanceof TypeError) {
        const causeMsg = e.cause instanceof Error ? e.cause.message : '';
        if (
          e.message.toLowerCase().includes('redirect') ||
          causeMsg.toLowerCase().includes('redirect')
        ) {
          return toolError(
            'リダイレクトされたため取得できません（セキュリティ上の制限）'
          );
        }
      }
      const msg = e instanceof Error ? e.message : String(e);
      return toolError(`URL の取得に失敗しました: ${msg}`);
    }

    if (!res.ok) {
      discardBody(res);
      return toolError(`HTTP ${res.status} ${res.statusText}`);
    }

    // Content-Type チェック（text/html または text/plain のみ）
    const contentType = res.headers.get('Content-Type') ?? '';
    if (
      !contentType.includes('text/html') &&
      !contentType.includes('text/plain')
    ) {
      discardBody(res);
      return toolError(
        `対応していないコンテンツタイプです (${contentType})。テキストまたは HTML のみ取得できます。`
      );
    }

    // Content-Length による早期拒否（補助。宣言が無い・偽っている場合は下の実受信量の検査で止める）
    const contentLength = Number(res.headers.get('Content-Length') ?? 0);
    if (contentLength > MAX_INPUT_BYTES) {
      discardBody(res);
      return toolError(
        `ページが大きすぎます（${Math.round(contentLength / 1024 / 1024)}MB）。2MB 以下のページのみ取得できます。`
      );
    }

    let raw: string;
    try {
      raw = await readBodyWithLimit(res, MAX_INPUT_BYTES, fetchSignal);
    } catch (e) {
      if (e instanceof BodyTooLargeError) return toolError(TOO_LARGE_REASON);
      if (isTimeoutError(e)) return toolError(TIMEOUT_REASON);
      const msg = e instanceof Error ? e.message : String(e);
      return toolError(`ページ本文の読み取りに失敗しました: ${msg}`);
    }

    const text = contentType.includes('text/html')
      ? stripHtml(raw)
      : raw.trim();

    return formatFetchedText(text);
  },
};
