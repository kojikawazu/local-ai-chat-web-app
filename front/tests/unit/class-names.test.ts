import { describe, it, expect } from 'vitest';
import { cn } from '@/lib/shared/class-names';

/**
 * クラス名の連結（`lib/shared/class-names.ts`。#163）の UT。文字列だけを扱う純関数のため mock は使わない。
 * 契約: 条件付きのクラス名を空白区切りで連結し、偽値は捨てる。
 */
describe('cn', () => {
  describe('正常系', () => {
    it('クラス名を空白区切りで連結する', () => {
      expect(cn('p-2', 'rounded-lg', 'text-sm')).toBe('p-2 rounded-lg text-sm');
    });

    it('条件が真のクラスだけを残す', () => {
      const checked = true;
      const disabled = false;
      expect(cn('base', checked && 'on', disabled && 'off')).toBe('base on');
    });
  });

  describe('準正常系', () => {
    it('null・undefined・空文字は捨てる（省略された className を渡してよい）', () => {
      expect(cn('base', null, undefined, '', 'end')).toBe('base end');
    });

    it('引数が無い・すべて偽値なら空文字を返す', () => {
      expect(cn()).toBe('');
      expect(cn(false, null, undefined)).toBe('');
    });
  });

  describe('異常系', () => {
    it('同じ性質のクラスが重なっても解決せず、そのまま並べる（呼び出し側が重ねない約束）', () => {
      expect(cn('px-3', 'pl-9')).toBe('px-3 pl-9');
    });
  });
});
