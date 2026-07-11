import { describe, it, expect } from 'vitest';
import { calculateTool } from '@/lib/tools/calculate';

/**
 * `calculateTool` の UT。自前の再帰下降パーサーは外部 I/O を持たないため mock は使わない。
 * 契約: 例外は投げず、結果もエラーも常に文字列で返す。成功時は `"式 = 結果"` 形式。
 */
const calc = (expression: unknown) => calculateTool.execute({ expression });

describe('calculateTool.execute', () => {
  describe('正常系', () => {
    it('演算子の優先順位を守って評価する', async () => {
      expect(await calc('2 + 3 * 4')).toBe('2 + 3 * 4 = 14');
    });

    it('括弧を優先して評価する', async () => {
      expect(await calc('(10 - 2) / 4')).toBe('(10 - 2) / 4 = 2');
    });

    it('単項マイナスを扱える', async () => {
      expect(await calc('-5 + 3')).toBe('-5 + 3 = -2');
    });

    it('非整数の結果は小数で返す', async () => {
      expect(await calc('10 / 4')).toBe('10 / 4 = 2.5');
    });

    it('小数の加算結果が整数なら整数表記で返す', async () => {
      expect(await calc('1.5 + 2.5')).toBe('1.5 + 2.5 = 4');
    });
  });

  describe('準正常系', () => {
    it('空文字はエラー文字列を返す', async () => {
      expect(await calc('')).toBe('エラー: 計算式が空です');
    });

    it('空白のみもエラー文字列を返す', async () => {
      expect(await calc('   ')).toBe('エラー: 計算式が空です');
    });

    it('expression が未指定（文字列でない）ときは空扱いでエラーを返す', async () => {
      expect(await calculateTool.execute({})).toBe('エラー: 計算式が空です');
    });

    it('割り切れない除算は 12 桁精度に丸めて返す', async () => {
      expect(await calc('1 / 3')).toBe('1 / 3 = 0.333333333333');
    });
  });

  describe('異常系', () => {
    it('許可外の文字（英字）を含むと専用エラーを返す', async () => {
      expect(await calc('2 + abc')).toBe(
        'エラー: 使用できない文字が含まれています。数字と四則演算子(+ - * /)と括弧のみ使用できます'
      );
    });

    it('ゼロ除算は不正結果エラーを返す', async () => {
      expect(await calc('1 / 0')).toBe('エラー: 計算結果が不正です（ゼロ除算等）');
    });

    it('演算子で終わる不完全な式はエラーを返す', async () => {
      expect(await calc('2 +')).toBe('エラー: 計算式が不完全です');
    });

    it('閉じられていない括弧はエラーを返す', async () => {
      expect(await calc('(2 + 3')).toBe('エラー: 括弧が閉じられていません');
    });

    it('演算子が連続する不正な式は形式エラーを返す', async () => {
      const res = await calc('2**3');
      expect(res).toMatch(/^エラー: 計算式の形式が正しくありません/);
    });
  });
});
