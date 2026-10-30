import http from 'http';
import net from 'net';
import type { LookupFunction } from 'net';
import type { Judgement } from './url-policy';
import { defaultPort } from './url-policy';
import { BROWSER_BLOCKED_HEADER } from '@/constants/agent/browser';

/**
 * 接続の宛先を判定する関数。
 *
 * @param hostname - 宛先のホスト名
 * @param port - 宛先のポート
 * @returns 判定の結果
 */
export type ProxyJudge = (hostname: string, port: number) => Promise<Judgement>;

/** 起動したプロキシ。 */
export type BrowserProxy = {
  /** Chromium の `proxy.server` に渡す URL（`http://127.0.0.1:<port>`） */
  server: string;
  /** 止めた接続（`ホスト:ポート（理由）`。新しい順ではなく起きた順） */
  blocked: string[];
  /** 待ち受けを止め、開いている接続をすべて切る */
  close: () => Promise<void>;
};

/**
 * 名前を引き直さず、判定に使ったアドレスだけを返す `lookup` を作る。
 *
 * Node は複数のアドレスを受け取ると順に接続を試す（`autoSelectFamily`。Node 20 以降の既定）ため、
 * `localhost` の `::1` で断られても `127.0.0.1` へ進める。判定していないアドレスへは接続しない。
 *
 * @param addresses - 判定に使ったアドレス
 * @returns `http.request`・`net.connect` の `lookup` に渡す関数
 */
export function pinnedLookup(addresses: readonly string[]): LookupFunction {
  const entries = addresses.map((address) => ({
    address,
    family: net.isIPv6(address) ? 6 : 4,
  }));
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, entries);
    } else {
      callback(null, entries[0].address, entries[0].family);
    }
  };
}

/** 上流へ渡さない、プロキシ宛てのヘッダー */
const HOP_HEADERS = ['proxy-connection', 'proxy-authorization'];

/**
 * 宛先を判定して中継する HTTP プロキシを、`127.0.0.1` の空きポートで起動する（#149。`docs/18-browser-tools.md`）。
 *
 * Chromium のすべての通信（転送の先・ページの中のリクエストを含む）をここへ通し、接続ごとに `judge` で判定する。
 * `http` はリクエストの URL、`https`・WebSocket は `CONNECT` の宛先で判定し、HTTPS の中身は解かない。
 * 通すときは、判定に使ったアドレスへ接続する（{@link pinnedLookup}。名前を引き直さないため、判定の後にアドレスを差し替えられない）。
 * 本文はためずに流す。止めた HTTP のリクエストには 403 と {@link BROWSER_BLOCKED_HEADER}、`CONNECT` には 403 を返す。
 *
 * @param judge - 宛先の判定
 * @returns 起動したプロキシ
 */
export async function startProxy(judge: ProxyJudge): Promise<BrowserProxy> {
  const blocked: string[] = [];
  const sockets = new Set<net.Socket>();
  const track = (socket: net.Socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  };

  const server = http.createServer((req, res) => {
    void forwardHttp(req, res);
  });
  server.on('connection', track);

  async function forwardHttp(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    let target: URL;
    try {
      // プロキシへのリクエストは絶対 URL で届く。相対なら、プロキシを直接開いたもの
      target = new URL(req.url ?? '');
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (target.protocol !== 'http:') {
      res.writeHead(400).end();
      return;
    }
    const port = defaultPort(target);
    const judgement = await judge(target.hostname, port);
    if (!judgement.allowed) {
      blocked.push(`${target.host}（${judgement.reason}）`);
      res
        .writeHead(403, {
          'content-type': 'text/plain; charset=utf-8',
          [BROWSER_BLOCKED_HEADER]: encodeURIComponent(judgement.reason),
        })
        .end(judgement.reason);
      return;
    }

    const headers = { ...req.headers };
    for (const name of HOP_HEADERS) delete headers[name];
    const upstream = http.request(
      {
        host: target.hostname.replace(/^\[(.*)\]$/, '$1'),
        lookup: pinnedLookup(judgement.addresses),
        port,
        method: req.method,
        path: target.pathname + target.search,
        // Host ヘッダーは元のまま渡す（接続先をアドレスにしても、仮想ホストを選べるように）
        headers,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      }
    );
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  }

  server.on('connect', (req, clientSocket: net.Socket, head: Buffer) => {
    track(clientSocket);
    void tunnel(req, clientSocket, head);
  });

  async function tunnel(
    req: http.IncomingMessage,
    clientSocket: net.Socket,
    head: Buffer
  ): Promise<void> {
    clientSocket.on('error', () => clientSocket.destroy());
    let target: URL;
    try {
      // CONNECT の宛先は `ホスト:ポート`（IPv6 は角括弧付き）。URL として読み、ホストとポートを取り出す
      target = new URL(`http://${req.url ?? ''}`);
    } catch {
      clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const port = defaultPort(target);
    const judgement = await judge(target.hostname, port);
    if (!judgement.allowed) {
      blocked.push(`${target.host}（${judgement.reason}）`);
      clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const upstream = net.connect({
      host: target.hostname.replace(/^\[(.*)\]$/, '$1'),
      port,
      lookup: pinnedLookup(judgement.addresses),
    });
    upstream.once('connect', () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    track(upstream);
    upstream.on('error', () => {
      if (!clientSocket.destroyed) {
        clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      }
    });
    clientSocket.on('close', () => upstream.destroy());
    upstream.on('close', () => clientSocket.destroy());
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  // listen(0, '127.0.0.1') の後の address() は AddressInfo（文字列になるのは UNIX ソケット・名前付きパイプのとき）
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    server: `http://127.0.0.1:${port}`,
    blocked,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
