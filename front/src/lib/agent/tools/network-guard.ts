import { lookup } from 'dns/promises';
import net from 'net';

// SSRF 防止: プライベート・特殊 IP アドレス範囲のブロックリスト。
// url_fetch とブラウザのツール（#149）で共有する。
// 文字列の正規表現では判定しない。WHATWG の URL は [::ffff:127.0.0.1] を [::ffff:7f00:1] に書き換え、
// 名前の解決もその形のまま返すため、書き方の違いですり抜ける。net.BlockList は IPv4-mapped IPv6（::ffff:0:0/96）を
// IPv4 の規則で判定する。NAT64（64:ff9b::/96）と IPv4-compatible（::/96）は、埋め込まれた IPv4 を取り出して判定する

/** 外部から使わせないアドレス */
const BLOCKED = new net.BlockList();
BLOCKED.addSubnet('127.0.0.0', 8, 'ipv4'); // ループバック
BLOCKED.addSubnet('10.0.0.0', 8, 'ipv4'); // RFC 1918
BLOCKED.addSubnet('172.16.0.0', 12, 'ipv4'); // RFC 1918
BLOCKED.addSubnet('192.168.0.0', 16, 'ipv4'); // RFC 1918
BLOCKED.addSubnet('169.254.0.0', 16, 'ipv4'); // リンクローカル
BLOCKED.addSubnet('0.0.0.0', 8, 'ipv4'); // カレントネットワーク（0.0.0.0 は自機に繋がる）
BLOCKED.addAddress('::', 'ipv6'); // 未指定（自機に繋がる）
BLOCKED.addAddress('::1', 'ipv6'); // ループバック
BLOCKED.addSubnet('fc00::', 7, 'ipv6'); // ユニークローカル
BLOCKED.addSubnet('fe80::', 10, 'ipv6'); // リンクローカル

/** 自機を指すアドレス（ループバック・未指定）。アプリ自身へ繋がるかの判定に使う */
const SELF = new net.BlockList();
SELF.addSubnet('127.0.0.0', 8, 'ipv4');
SELF.addSubnet('0.0.0.0', 8, 'ipv4');
SELF.addAddress('::', 'ipv6');
SELF.addAddress('::1', 'ipv6');

/** IPv4 を末尾 32 ビットに埋め込む IPv6 の範囲（NAT64・IPv4-compatible） */
const EMBEDS_IPV4 = new net.BlockList();
EMBEDS_IPV4.addSubnet('64:ff9b::', 96, 'ipv6');
EMBEDS_IPV4.addSubnet('::', 96, 'ipv6');

/**
 * IPv6 アドレスを 8 つの 16 ビットの値に展開する（`::` の省略と、末尾の `a.b.c.d` の形に対応）。
 *
 * @param ip - IPv6 アドレス（`net.isIPv6` が true のもの）
 * @returns 8 つの値
 */
function expandIpv6(ip: string): number[] {
  let text = ip.replace(/%.*$/, ''); // ゾーン ID（fe80::1%en0）は外す
  const dotted = text.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split('::');
  const parse = (part: string | undefined) =>
    part ? part.split(':').map((group) => parseInt(group, 16)) : [];
  const front = parse(head);
  const back = parse(tail);
  const zeros =
    tail === undefined ? [] : new Array(8 - front.length - back.length).fill(0);
  return [...front, ...zeros, ...back];
}

/**
 * アドレスがリストに当たるかを判定する。IPv6 に埋め込まれた IPv4（NAT64・IPv4-compatible）も取り出して判定する。
 *
 * @param list - 判定に使うリスト
 * @param address - IP アドレス
 * @returns 当たれば true。IP アドレスとして読めなければ true（判定できないものは通さない）
 */
function matches(list: net.BlockList, address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return list.check(address, 'ipv4');
  if (family !== 6) return true;
  if (list.check(address, 'ipv6')) return true;
  if (address !== '::' && EMBEDS_IPV4.check(address, 'ipv6')) {
    const groups = expandIpv6(address);
    const embedded = [
      groups[6] >> 8,
      groups[6] & 0xff,
      groups[7] >> 8,
      groups[7] & 0xff,
    ].join('.');
    return list.check(embedded, 'ipv4');
  }
  return false;
}

/**
 * アドレスがプライベート・ループバック・リンクローカル・未指定等の、外部から使わせない範囲かを判定する。
 *
 * IPv4-mapped（`::ffff:7f00:1` の形も）・NAT64・IPv4-compatible の IPv6 は、埋め込まれた IPv4 で判定する。
 *
 * @param address - 名前を引いた結果の IP アドレス
 * @returns 止める範囲なら true（IP アドレスとして読めないものも true）
 */
export function isBlockedAddress(address: string): boolean {
  return matches(BLOCKED, address);
}

/**
 * アドレスが自機を指すか（ループバック・未指定。`127.0.0.0/8`・`0.0.0.0/8`・`::1`・`::` と、それを埋め込んだ IPv6）を判定する。
 *
 * ブラウザのツールが、このアプリ自身へ繋がる宛先を止めるのに使う（#149）。
 *
 * @param address - 名前を引いた結果の IP アドレス
 * @returns 自機を指すなら true（IP アドレスとして読めないものも true）
 */
export function isLoopbackAddress(address: string): boolean {
  return matches(SELF, address);
}

/**
 * ホスト名の名前を引き、すべてのアドレスを返す。
 *
 * @param hostname - ホスト名（IP アドレスの文字列ならそのまま返る）。`[::1]` の角括弧は外して渡す
 * @returns 引けたアドレス
 * @throws {Error} 名前を引けない場合
 */
export async function resolveAddresses(hostname: string): Promise<string[]> {
  try {
    const result = await lookup(hostname, { all: true });
    return result.map((r) => r.address);
  } catch {
    throw new Error(`ホスト名 "${hostname}" を解決できません`);
  }
}

/**
 * ホスト名を引いたアドレスに、止める範囲（{@link isBlockedAddress}）が無いことを確かめる。
 *
 * @param hostname - ホスト名
 * @throws {Error} 名前を引けない、または止める範囲のアドレスを含む場合
 */
export async function checkSsrf(hostname: string): Promise<void> {
  for (const address of await resolveAddresses(hostname)) {
    if (isBlockedAddress(address)) {
      throw new Error(`アクセスが禁止されているアドレス範囲です: ${address}`);
    }
  }
}
