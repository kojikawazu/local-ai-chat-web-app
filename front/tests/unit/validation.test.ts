import { describe, it, expect } from 'vitest';
import { isValidUUID, MAX_MESSAGE_LENGTH, MAX_TITLE_LENGTH } from '@/lib/validation';

/**
 * `lib/validation` の UT。外部 I/O を持たない純関数のため mock は使わない。
 * `isValidUUID` は「UUID の 8-4-4-4-12 16進フォーマット」のみを検証する契約
 * （version/variant ビットの妥当性までは見ない）ことを踏まえて期待値を組む。
 */
describe('isValidUUID', () => {
  describe('正常系', () => {
    it('小文字の UUID を true と判定する', () => {
      expect(isValidUUID('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    });

    it('大文字混在でも true と判定する（大文字小文字不問）', () => {
      expect(isValidUUID('123E4567-E89B-12D3-A456-426614174000')).toBe(true);
    });

    it('全ゼロ UUID もフォーマット上は true と判定する', () => {
      expect(isValidUUID('00000000-0000-0000-0000-000000000000')).toBe(true);
    });
  });

  describe('準正常系', () => {
    it('version/variant が UUID 仕様外でもフォーマットが合えば true（形式のみ検証する契約）', () => {
      // 3 番目のブロックが v4 を示す '4' でなくても、16進 8-4-4-4-12 なら true になる。
      expect(isValidUUID('12345678-1234-1234-1234-123456789012')).toBe(true);
    });
  });

  describe('異常系', () => {
    it('ハイフンが無い文字列は false', () => {
      expect(isValidUUID('123e4567e89b12d3a456426614174000')).toBe(false);
    });

    it('桁数が不足する文字列は false', () => {
      expect(isValidUUID('123e4567-e89b-12d3-a456-42661417400')).toBe(false);
    });

    it('16進以外の文字（g）を含むと false', () => {
      expect(isValidUUID('123e4567-e89b-12d3-a456-42661417400g')).toBe(false);
    });

    it('前後に空白があると false（完全一致で検証するため）', () => {
      expect(isValidUUID(' 123e4567-e89b-12d3-a456-426614174000 ')).toBe(false);
    });

    it('空文字は false', () => {
      expect(isValidUUID('')).toBe(false);
    });
  });
});

describe('入力上限の定数', () => {
  describe('正常系', () => {
    it('メッセージ上限は 10000 文字', () => {
      expect(MAX_MESSAGE_LENGTH).toBe(10000);
    });

    it('タイトル上限は 100 文字', () => {
      expect(MAX_TITLE_LENGTH).toBe(100);
    });
  });
});
