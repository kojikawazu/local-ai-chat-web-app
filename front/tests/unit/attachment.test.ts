import { describe, it, expect } from 'vitest';
import {
  base64DecodedLength,
  decodeBase64,
  detectImageMimeType,
} from '@/lib/server/attachment';

/**
 * `lib/server/attachment` の UT（#6）。
 * 添付画像の形式をクライアントの申告ではなく中身の先頭で決めること、壊れた Base64 を黙って
 * 復号しないことを確かめる。純関数のため mock は使わない。
 */

/** PNG のシグネチャ（先頭 8 バイト）。 */
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe('detectImageMimeType', () => {
  describe('正常系', () => {
    it('PNG のシグネチャで始まれば image/png', () => {
      expect(detectImageMimeType(new Uint8Array([...PNG, 0x00]))).toBe(
        'image/png'
      );
    });

    it('JPEG の SOI マーカーで始まれば image/jpeg', () => {
      expect(
        detectImageMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe1]))
      ).toBe('image/jpeg');
    });
  });

  describe('準正常系', () => {
    it('シグネチャちょうどの長さでも判定できる（境界値）', () => {
      expect(detectImageMimeType(new Uint8Array(PNG))).toBe('image/png');
      expect(detectImageMimeType(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(
        'image/jpeg'
      );
    });
  });

  describe('異常系', () => {
    it.each([
      ['GIF', new TextEncoder().encode('GIF89a')],
      ['WebP', new TextEncoder().encode('RIFF\0\0\0\0WEBP')],
      [
        'SVG',
        new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">'),
      ],
      ['空', new Uint8Array()],
      ['PNG のシグネチャの途中まで', new Uint8Array(PNG.slice(0, 7))],
    ])('%sなら null', (_label, bytes) => {
      expect(detectImageMimeType(bytes)).toBeNull();
    });
  });
});

describe('decodeBase64', () => {
  describe('正常系', () => {
    it('標準の Base64 を復号する', () => {
      const bytes = new Uint8Array([0, 1, 2, 250, 251, 252]);
      expect(decodeBase64(Buffer.from(bytes).toString('base64'))).toEqual(
        bytes
      );
    });
  });

  describe('準正常系', () => {
    it('末尾の = が 1 つ・2 つの Base64 も復号する', () => {
      expect(decodeBase64('YWI=')).toEqual(new TextEncoder().encode('ab'));
      expect(decodeBase64('YQ==')).toEqual(new TextEncoder().encode('a'));
    });
  });

  describe('異常系', () => {
    it.each([
      ['空', ''],
      ['長さが 4 の倍数でない', 'YWJ'],
      ['許可しない文字を含む', 'YW!j'],
      ['URL 用の文字（- _）を含む', 'YW-_'],
      ['改行を含む', 'YWJj\nZGVm'],
      ['data: URI', 'data:image/png;base64,YWJj'],
      ['= が 3 つ', 'Y==='],
    ])('%sなら null', (_label, value) => {
      expect(decodeBase64(value)).toBeNull();
    });
  });
});

describe('base64DecodedLength', () => {
  describe('正常系', () => {
    it('復号後のバイト数を、復号せずに求める', () => {
      for (const length of [1, 2, 3, 4, 5, 6, 100]) {
        const encoded = Buffer.alloc(length).toString('base64');
        expect(base64DecodedLength(encoded)).toBe(length);
      }
    });
  });

  describe('準正常系', () => {
    it('空文字は 0', () => {
      expect(base64DecodedLength('')).toBe(0);
    });
  });

  // 異常系: 入力は decodeBase64 と同じ形を前提にした計算だけで、失敗の経路を持たない。
  // 不正な文字列は、この値で上限を判定した後に decodeBase64 が弾く（request-body.test.ts で確かめる）
});
