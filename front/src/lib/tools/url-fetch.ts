import { Tool } from './types';
import { lookup } from 'dns/promises';

const MAX_CHARS = 5000;
const MAX_INPUT_BYTES = 2 * 1024 * 1024; // 2MB: メモリ枯渇防止
const FETCH_TIMEOUT_MS = 15000;

// SSRF 防止: プライベート・特殊 IP アドレス範囲のブロックリスト
// IPv4-mapped IPv6（::ffff:x.x.x.x）はホスト部を正規化してから照合する

function ipToNumber(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function inCidr(ip: string, cidr: string): boolean {
  const [base, bits] = cidr.split('/');
  const mask = bits ? (~0 << (32 - Number(bits))) >>> 0 : 0xffffffff;
  return (ipToNumber(ip) & mask) === (ipToNumber(base) & mask);
}

const IPV4_BLOCKLIST = [
  '127.0.0.0/8',    // ループバック
  '10.0.0.0/8',     // RFC 1918
  '172.16.0.0/12',  // RFC 1918
  '192.168.0.0/16', // RFC 1918
  '169.254.0.0/16', // リンクローカル
  '0.0.0.0/8',      // カレントネットワーク
];


function normalizeIp(raw: string): { isV4: boolean; ip: string } {
  // IPv4-mapped IPv6 形式（::ffff:192.168.1.1）を IPv4 に正規化
  const mapped = raw.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return { isV4: true, ip: mapped[1] };
  // 純粋な IPv4
  if (/^\d+\.\d+\.\d+\.\d+$/.test(raw)) return { isV4: true, ip: raw };
  return { isV4: false, ip: raw };
}

function isBlockedIpv6(ip: string): boolean {
  if (ip === '::1') return true;
  // fc00::/7: 先頭 7 ビットが 1111110 → 先頭バイトが fc または fd
  if (/^f[cd]/i.test(ip)) return true;
  // fe80::/10: 先頭 10 ビットが 1111111010 → fe80〜febf
  if (/^fe[89ab]/i.test(ip)) return true;
  return false;
}

async function checkSsrf(hostname: string): Promise<void> {
  let addresses: string[];
  try {
    const result = await lookup(hostname, { all: true });
    addresses = result.map((r) => r.address);
  } catch {
    throw new Error(`ホスト名 "${hostname}" を解決できません`);
  }

  for (const raw of addresses) {
    const { isV4, ip } = normalizeIp(raw);
    if (isV4) {
      for (const cidr of IPV4_BLOCKLIST) {
        if (inCidr(ip, cidr)) {
          throw new Error(`アクセスが禁止されているアドレス範囲です: ${ip}`);
        }
      }
    } else {
      // isBlockedIpv6() で ::1 / fc00::/7 / fe80::/10 を全てカバーしている
      if (isBlockedIpv6(ip)) {
        throw new Error(`アクセスが禁止されているアドレス範囲です: ${ip}`);
      }
    }
  }
}

// HTML タグを除去してプレーンテキストを抽出する
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')  // script ブロック除去
    .replace(/<style[\s\S]*?<\/style>/gi, '')     // style ブロック除去
    .replace(/<!--[\s\S]*?-->/g, '')              // コメント除去
    .replace(/<[^>]+>/g, ' ')                     // タグ除去
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')                      // 連続空白を 1 つに
    .trim();
}

export const urlFetchTool: Tool = {
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
  execute: async (args) => {
    const url = typeof args.url === 'string' ? args.url.trim() : '';
    if (!url) return 'エラー: URL が空です';

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return 'エラー: URL の形式が正しくありません';
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return 'エラー: http:// または https:// で始まる URL のみ対応しています';
    }

    // SSRF チェック
    try {
      await checkSsrf(parsedUrl.hostname);
    } catch (e) {
      return `エラー: ${e instanceof Error ? e.message : String(e)}`;
    }

    // fetch（リダイレクト禁止）
    let res: Response;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        res = await fetch(url, {
          redirect: 'error',
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LocalAIChatBot/1.0)' },
        });
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (e) {
      // redirect: 'error' 時のリダイレクト検出: TypeError かつメッセージに 'redirect' を含む
      // undici の実装に依存するが、TypeError であることは仕様として安定している
      if (e instanceof TypeError && String(e.message).toLowerCase().includes('redirect')) {
        return 'エラー: リダイレクトされたため取得できません（セキュリティ上の制限）';
      }
      const msg = e instanceof Error ? e.message : String(e);
      return `エラー: URL の取得に失敗しました: ${msg}`;
    }

    if (!res.ok) {
      return `エラー: HTTP ${res.status} ${res.statusText}`;
    }

    // Content-Type チェック（text/html または text/plain のみ）
    const contentType = res.headers.get('Content-Type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return `エラー: 対応していないコンテンツタイプです (${contentType})。テキストまたは HTML のみ取得できます。`;
    }

    // Content-Length による事前サイズチェック（ヘッダーがない場合はスキップ）
    const contentLength = Number(res.headers.get('Content-Length') ?? 0);
    if (contentLength > MAX_INPUT_BYTES) {
      return `エラー: ページが大きすぎます（${Math.round(contentLength / 1024 / 1024)}MB）。2MB 以下のページのみ取得できます。`;
    }

    const raw = await res.text();

    // Content-Length なしの場合のサイズチェック（ストリーム展開後）
    if (raw.length > MAX_INPUT_BYTES) {
      return 'エラー: ページが大きすぎます（2MB 超）。';
    }

    const text = contentType.includes('text/html') ? stripHtml(raw) : raw.trim();

    if (!text) return '（ページにテキストコンテンツが見つかりませんでした）';

    return text.length > MAX_CHARS
      ? text.slice(0, MAX_CHARS) + '\n\n…（5,000文字を超えたため省略）'
      : text;
  },
};
