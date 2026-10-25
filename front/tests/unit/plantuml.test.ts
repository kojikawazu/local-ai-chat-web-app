import { describe, it, expect } from 'vitest';
import { formatPlantUmlError } from '@/lib/server/plantuml';

/**
 * `lib/server/plantuml` の UT（#171）。
 * PlantUML サーバーが描けなかったときの応答ヘッダー（理由と 0 始まりの行番号）から、利用者に見せる
 * メッセージを作る処理を確かめる。サーバーとの通信（`renderPlantUml`）は IT（plantuml.test.ts）で検証する。
 */

describe('formatPlantUmlError', () => {
  describe('正常系', () => {
    it('理由に 1 始まりの行番号を添える', () => {
      expect(
        formatPlantUmlError(
          'Syntax Error? (Assumed diagram type: sequence)',
          '1'
        )
      ).toBe('Syntax Error? (Assumed diagram type: sequence)（2 行目）');
    });

    it('先頭の行（0）は 1 行目にする', () => {
      expect(formatPlantUmlError('Cannot open URL', '0')).toBe(
        'Cannot open URL（1 行目）'
      );
    });
  });

  describe('準正常系', () => {
    it('行番号のヘッダーが無ければ理由だけを返す', () => {
      expect(formatPlantUmlError('cannot include /etc/passwd', null)).toBe(
        'cannot include /etc/passwd'
      );
    });

    it('理由の前後の空白を落とす', () => {
      expect(formatPlantUmlError('  Syntax Error?  ', ' 3 ')).toBe(
        'Syntax Error?（4 行目）'
      );
    });
  });

  describe('異常系', () => {
    it('理由のヘッダーが無い・空なら、決まったメッセージにする', () => {
      expect(formatPlantUmlError(null, null)).toBe(
        'PlantUML が図を描けませんでした'
      );
      expect(formatPlantUmlError('   ', '2')).toBe(
        'PlantUML が図を描けませんでした（3 行目）'
      );
    });

    it.each([
      ['空', ''],
      ['数値でない', 'abc'],
      ['負の数', '-1'],
      ['小数', '1.5'],
    ])('行番号が%sなら添えない', (_label, line) => {
      expect(formatPlantUmlError('Syntax Error?', line)).toBe('Syntax Error?');
    });
  });
});
