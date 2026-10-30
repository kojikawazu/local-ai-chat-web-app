import {
  isBlockedAddress,
  isLoopbackAddress,
  resolveAddresses,
} from '../network-guard';

/**
 * URL のポートを返す。省略されていればスキームの既定のポート。
 *
 * @param url - `http`・`https` の URL
 * @returns ポート番号
 */
export function defaultPort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === 'https:' ? 443 : 80;
}

/**
 * ホストとポートを、手元の開発サーバーの照合に使う 1 つの文字列にする（#149）。
 *
 * ホスト名は小文字にそろえる。IPv6 は `URL` の `hostname` と同じく角括弧付きで書く（`[::1]:3000`）。
 *
 * @param hostname - ホスト名
 * @param port - ポート番号
 * @returns `ホスト:ポート`
 */
export function hostKey(hostname: string, port: number): string {
  return `${hostname.toLowerCase()}:${port}`;
}

/** {@link parseBrowserUrl} の結果。 */
type ParsedBrowserUrl =
  | {
      ok: true;
      /** 開く URL */
      url: URL;
      /** ポート（省略時はスキームの既定のポート） */
      port: number;
    }
  | {
      ok: false;
      /** 開けない理由 */
      reason: string;
    };

/**
 * モデルが渡した値を、ブラウザで開く URL として読む（#149）。
 *
 * `http`・`https` だけを受け付ける（`file:`・`data:`・`javascript:` 等で手元のファイル・任意のスクリプトに届かせない）。
 *
 * @param raw - モデルが渡した値
 * @returns 読めた URL とポート、または開けない理由
 */
export function parseBrowserUrl(raw: unknown): ParsedBrowserUrl {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return { ok: false, reason: 'URL が空です' };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: 'URL の形式が正しくありません' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      ok: false,
      reason: 'http:// または https:// で始まる URL のみ開けます',
    };
  }
  return { ok: true, url, port: defaultPort(url) };
}

/**
 * URL が、許可した手元の開発サーバーのものかを返す（#149）。名前は引かない（文字列で照合する）。
 *
 * @param raw - URL（文字列でない・読めないなら false）
 * @param localOrigins - 開いてよい手元の開発サーバー（{@link hostKey} の形）
 * @returns 許可した手元の開発サーバーなら true
 */
export function isLocalOriginUrl(
  raw: unknown,
  localOrigins: readonly string[]
): boolean {
  const parsed = parseBrowserUrl(raw);
  return (
    parsed.ok &&
    localOrigins.includes(hostKey(parsed.url.hostname, parsed.port))
  );
}

/**
 * アプリ自身のオリジンからポートを取り出す（#149）。
 *
 * @param appOrigin - `/api/chat` のリクエストのオリジン
 * @returns ポート。オリジンが無い・読めないなら `undefined`（アプリ自身の判定をしない）
 */
export function appPortOf(appOrigin: string | undefined): number | undefined {
  if (!appOrigin) return undefined;
  try {
    return defaultPort(new URL(appOrigin));
  } catch {
    return undefined;
  }
}

/** 宛先の判定に使う決まり。 */
export type DestinationPolicy = {
  /** 開いてよい手元の開発サーバー（{@link hostKey} の形） */
  localOrigins: readonly string[];
  /** アプリ自身のポート。ループバックのこのポートへは接続しない。`undefined` なら判定しない */
  appPort?: number;
  /**
   * 公開の Web へ接続してよいか。手元の情報を読んだ後は false にする（読んだ内容を外へ送らせない）
   *
   * @returns 接続してよいなら true
   */
  publicAllowed: () => boolean;
};

/** 宛先の判定の結果。 */
export type Judgement =
  | {
      allowed: true;
      /** 手元の開発サーバー（`local`）か公開の Web（`public`）か */
      kind: 'local' | 'public';
      /**
       * 接続してよいアドレス（判定に使ったものすべて）。名前を引き直さずに、この中から接続する
       * （`localhost` は `::1` と `127.0.0.1` の両方に引け、開発サーバーが片方だけで待ち受けることがあるため、1 つに絞らない）
       */
      addresses: string[];
    }
  | {
      allowed: false;
      /** 止めた理由 */
      reason: string;
    };

/**
 * 最上位のページが手元の開発サーバーでないときは、手元の開発サーバーへの接続を断る（#149）。
 *
 * 公開のページの中のスクリプト・iframe・画像から手元の開発サーバーへ接続させない。開発サーバーは CORS を
 * すべて許可していることが多く（Vite の既定等）、公開のページが手元の内容を読んで外へ送れる。
 * また、公開のページに書き出された手元の内容は、ページの URL では手元と分からないまま、モデルへ渡る。
 * 最上位のページが手元の開発サーバーなら通す（そのページが公開の CDN を読むのは止めない）。
 *
 * @param judgement - 宛先の判定（{@link judgeDestination}）
 * @param topIsLocal - 最上位のページ（開こうとしているページを含む）が手元の開発サーバーか
 * @returns 手元への接続で、最上位が公開のページなら断る判定。それ以外はそのまま
 */
export function gateByTopPage(
  judgement: Judgement,
  topIsLocal: boolean
): Judgement {
  if (judgement.allowed && judgement.kind === 'local' && !topIsLocal) {
    return {
      allowed: false,
      reason:
        '公開のページから手元の開発サーバーへは接続しません（手元の内容を公開のページに読ませないため）',
    };
  }
  return judgement;
}

/**
 * 接続の宛先を判定する（#149。`docs/18-browser-tools.md`「開いてよい URL」）。
 *
 * 名前を引き、次の順に決める。
 * 1. ループバックでアプリ自身のポート → 止める（`BROWSER_LOCAL_ORIGINS` に書いてあっても）
 * 2. 許可した手元の開発サーバー → 通す（`local`）
 * 3. プライベート・ループバック・リンクローカルのアドレスを含む → 止める
 * 4. 手元の情報を読んだ後 → 止める
 * 5. それ以外 → 通す（`public`）
 *
 * @param hostname - 宛先のホスト名（IPv6 は角括弧付きでもよい）
 * @param port - 宛先のポート
 * @param policy - 判定の決まり
 * @param resolve - 名前を引く関数（テストで差し替える）
 * @returns 判定の結果
 */
export async function judgeDestination(
  hostname: string,
  port: number,
  policy: DestinationPolicy,
  resolve: (hostname: string) => Promise<string[]> = resolveAddresses
): Promise<Judgement> {
  let addresses: string[];
  try {
    addresses = await resolve(hostname.replace(/^\[(.*)\]$/, '$1'));
  } catch (e) {
    return {
      allowed: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
  if (addresses.length === 0) {
    return {
      allowed: false,
      reason: `ホスト名 "${hostname}" を解決できません`,
    };
  }
  if (
    policy.appPort !== undefined &&
    port === policy.appPort &&
    addresses.some(isLoopbackAddress)
  ) {
    return { allowed: false, reason: 'このアプリ自身は開けません' };
  }
  if (policy.localOrigins.includes(hostKey(hostname, port))) {
    return { allowed: true, kind: 'local', addresses };
  }
  const blocked = addresses.find(isBlockedAddress);
  if (blocked) {
    return {
      allowed: false,
      reason: `プライベートのアドレス（${blocked}）のため開けません。手元の開発サーバーなら BROWSER_LOCAL_ORIGINS に書いてください`,
    };
  }
  if (!policy.publicAllowed()) {
    return {
      allowed: false,
      reason:
        'この応答では手元の情報を読んだため、外部の Web には接続しません（読んだ内容を外へ送らないため）',
    };
  }
  return { allowed: true, kind: 'public', addresses };
}
