import { describe, it, expect } from 'vitest';
import {
  parseSidebarVisibility,
  serializeSidebarVisibility,
} from '@/lib/sidebar/visibility';

/**
 * `lib/sidebar/visibility` の UT（#24）。
 * localStorage に保存したサイドバーの表示状態の解釈と、保存する値を確かめる。純関数のため mock は使わない。
 */

describe('parseSidebarVisibility', () => {
  describe('正常系', () => {
    it('open は表示、closed は非表示にする', () => {
      expect(parseSidebarVisibility('open')).toBe(true);
      expect(parseSidebarVisibility('closed')).toBe(false);
    });
  });

  describe('準正常系', () => {
    it('未保存（null）は表示にする', () => {
      expect(parseSidebarVisibility(null)).toBe(true);
    });
  });

  describe('異常系', () => {
    it.each(['', 'CLOSED', ' closed', 'false', '0', 'hidden'])(
      '不正な値（%j）は表示にする',
      (value) => {
        expect(parseSidebarVisibility(value)).toBe(true);
      }
    );
  });
});

describe('serializeSidebarVisibility', () => {
  describe('正常系', () => {
    it('表示は open、非表示は closed にする', () => {
      expect(serializeSidebarVisibility(true)).toBe('open');
      expect(serializeSidebarVisibility(false)).toBe('closed');
    });
  });

  describe('準正常系', () => {
    it('保存した値を解釈すると元の状態に戻る', () => {
      for (const isOpen of [true, false]) {
        expect(parseSidebarVisibility(serializeSidebarVisibility(isOpen))).toBe(
          isOpen
        );
      }
    });
  });

  // 異常系: 引数は boolean だけで、型の外の入力は TypeScript が弾く。実行時の不正な値（localStorage 由来）は
  // parseSidebarVisibility 側の異常系で検証している
});
