import { describe, it, expect } from 'vitest';
import { calculateTool } from '@/lib/agent/tools/calculate';

/**
 * `calculateTool` の UT。自前の再帰下降パーサーは外部 I/O を持たないため mock は使わない。
 * 契約: 例外は投げない。成功時の文章は `"式 = 結果"` 形式で要約は `"= 結果"`、
 * 失敗は `isError: true` で文章は `"エラー: <理由>"`・要約は理由（#150）。
 */
// 計算は即時に終わり中断を見ないため、signal は使い捨ての未中断のもので足りる
const signal = new AbortController().signal;
const calc = (expression: unknown) =>
  calculateTool.execute({ expression }, signal);

/**
 * 失敗したときに期待する実行結果。
 *
 * @param reason - 失敗の理由
 * @returns モデルへ返す文章・成否・要約
 */
const failure = (reason: string) => ({
  result: `エラー: ${reason}`,
  isError: true,
  summary: reason,
});

describe('calculateTool.execute', () => {
  describe('正常系', () => {
    it('演算子の優先順位を守って評価する', async () => {
      expect(await calc('2 + 3 * 4')).toEqual({
        result: '2 + 3 * 4 = 14',
        isError: false,
        summary: '= 14',
      });
    });

    it('括弧を優先して評価する', async () => {
      expect(await calc('(10 - 2) / 4')).toEqual({
        result: '(10 - 2) / 4 = 2',
        isError: false,
        summary: '= 2',
      });
    });

    it('単項マイナスを扱える', async () => {
      expect(await calc('-5 + 3')).toEqual({
        result: '-5 + 3 = -2',
        isError: false,
        summary: '= -2',
      });
    });

    it('非整数の結果は小数で返す', async () => {
      expect(await calc('10 / 4')).toEqual({
        result: '10 / 4 = 2.5',
        isError: false,
        summary: '= 2.5',
      });
    });

    it('小数の加算結果が整数なら整数表記で返す', async () => {
      expect(await calc('1.5 + 2.5')).toEqual({
        result: '1.5 + 2.5 = 4',
        isError: false,
        summary: '= 4',
      });
    });
  });

  describe('準正常系', () => {
    it('空文字は失敗として返す', async () => {
      expect(await calc('')).toEqual(failure('計算式が空です'));
    });

    it('空白のみも失敗として返す', async () => {
      expect(await calc('   ')).toEqual(failure('計算式が空です'));
    });

    it('expression が未指定（文字列でない）ときは空扱いでエラーを返す', async () => {
      expect(await calculateTool.execute({}, signal)).toEqual(
        failure('計算式が空です')
      );
    });

    it('割り切れない除算は 12 桁精度に丸めて返す', async () => {
      expect(await calc('1 / 3')).toEqual({
        result: '1 / 3 = 0.333333333333',
        isError: false,
        summary: '= 0.333333333333',
      });
    });
  });

  describe('異常系', () => {
    it('許可外の文字（英字）を含むと専用エラーを返す', async () => {
      expect(await calc('2 + abc')).toEqual(
        failure(
          '使用できない文字が含まれています。数字と四則演算子(+ - * /)と括弧のみ使用できます'
        )
      );
    });

    it('ゼロ除算は不正結果エラーを返す', async () => {
      expect(await calc('1 / 0')).toEqual(
        failure('計算結果が不正です（ゼロ除算等）')
      );
    });

    it('演算子で終わる不完全な式はエラーを返す', async () => {
      expect(await calc('2 +')).toEqual(failure('計算式が不完全です'));
    });

    it('閉じられていない括弧はエラーを返す', async () => {
      expect(await calc('(2 + 3')).toEqual(failure('括弧が閉じられていません'));
    });

    it('演算子が連続する不正な式は形式エラーを返す', async () => {
      const res = await calc('2**3');
      expect(res.isError).toBe(true);
      expect(res.result).toMatch(/^エラー: 計算式の形式が正しくありません/);
    });
  });
});
