import { describe, it, expect } from 'vitest';
import {
  isBlockedAddress,
  isLoopbackAddress,
} from '@/lib/agent/tools/network-guard';

/**
 * プライベートのアドレスの判定（`network-guard.ts`。url_fetch とブラウザのツール（#149）で共有）の UT。
 *
 * 書き方の違い（WHATWG の URL が `[::ffff:127.0.0.1]` を `[::ffff:7f00:1]` に書き換える等）ですり抜けないことを確かめる。
 * 名前の解決は使わない（アドレスの文字列だけを判定する）。
 */

describe('isBlockedAddress', () => {
  describe('正常系', () => {
    it.each([
      ['93.184.215.14'],
      ['8.8.8.8'],
      ['2606:2800:220:1:248:1893:25c8:1946'],
      ['::ffff:8.8.8.8'],
      ['64:ff9b::808:808'],
    ])('公開のアドレス %s は通す', (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    });
  });

  describe('準正常系', () => {
    it.each([
      ['127.0.0.1'],
      ['10.1.2.3'],
      ['172.16.0.1'],
      ['192.168.1.1'],
      ['169.254.169.254'],
      ['0.0.0.0'],
      ['::1'],
      ['fd00::1'],
      ['fe80::1'],
    ])(
      'プライベート・ループバック・リンクローカルの %s は止める',
      (address) => {
        expect(isBlockedAddress(address)).toBe(true);
      }
    );
  });

  describe('異常系', () => {
    it.each([
      ['IPv4-mapped（10 進）', '::ffff:127.0.0.1'],
      ['IPv4-mapped（16 進。URL が書き換える形）', '::ffff:7f00:1'],
      ['IPv4-mapped（省略しない形）', '0:0:0:0:0:ffff:c0a8:0101'],
      ['未指定', '::'],
      ['NAT64 に埋め込んだループバック', '64:ff9b::7f00:1'],
      ['IPv4-compatible に埋め込んだプライベート', '::10.0.0.1'],
      ['IP アドレスとして読めない', 'not-an-ip'],
    ])('%s（%s）ですり抜けない', (_label, address) => {
      expect(isBlockedAddress(address)).toBe(true);
    });
  });
});

describe('isLoopbackAddress', () => {
  describe('正常系', () => {
    it.each([['127.0.0.1'], ['127.1.2.3'], ['::1']])(
      'ループバックの %s は自機',
      (address) => {
        expect(isLoopbackAddress(address)).toBe(true);
      }
    );
  });

  describe('準正常系', () => {
    it.each([['192.168.1.1'], ['8.8.8.8'], ['fd00::1']])(
      '%s は自機ではない',
      (address) => {
        expect(isLoopbackAddress(address)).toBe(false);
      }
    );
  });

  describe('異常系', () => {
    it.each([['0.0.0.0'], ['::'], ['::ffff:7f00:1'], ['64:ff9b::7f00:1']])(
      '自機に繋がる別の書き方 %s も自機とみなす',
      (address) => {
        expect(isLoopbackAddress(address)).toBe(true);
      }
    );
  });
});
