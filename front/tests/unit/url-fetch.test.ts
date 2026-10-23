import { describe, it, expect } from 'vitest';
import { formatFetchedText } from '@/lib/tools/url-fetch';

/**
 * `formatFetchedText` の UT。取得済みの本文を受け取る純関数のため mock は使わない。
 * 契約: 本文をモデルへ返す文章にし、見出しの要約に文字数を出す。5,000 文字を超えたら省略し、
 * 元の文字数と省略した旨を要約に出す。本文が無ければ空の結果にする（#150）。
 */
describe('formatFetchedText', () => {
  describe('正常系', () => {
    it('本文をそのまま返し、要約は 3 桁区切りの文字数にする', () => {
      const text = 'あ'.repeat(1234);

      expect(formatFetchedText(text)).toEqual({
        result: text,
        isError: false,
        summary: '1,234 文字',
      });
    });
  });

  describe('準正常系', () => {
    it('ちょうど 5,000 文字なら省略しない', () => {
      const text = 'a'.repeat(5000);

      expect(formatFetchedText(text)).toEqual({
        result: text,
        isError: false,
        summary: '5,000 文字',
      });
    });

    it('5,000 文字を超えたら省略し、元の文字数と省略した旨を要約に出す', () => {
      const output = formatFetchedText('a'.repeat(12345));

      expect(output).toMatchObject({
        isError: false,
        summary: '12,345 文字（5,000 文字に省略）',
      });
      expect(output.result).toBe(
        'a'.repeat(5000) + '\n\n…（5,000文字を超えたため省略）'
      );
    });
  });

  describe('異常系', () => {
    it('本文が空なら、失敗ではなく空の結果として返す', () => {
      expect(formatFetchedText('')).toEqual({
        result: '（ページにテキストコンテンツが見つかりませんでした）',
        isError: false,
        summary: '本文なし',
        isEmpty: true,
      });
    });
  });
});
