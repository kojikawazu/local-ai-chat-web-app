import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parsePositiveIntEnv } from '@/lib/agent/agent-config';

/**
 * `lib/agent/agent-config` の UT。純関数だが、不正値の通知に `console.warn` を使うため、
 * その出力（外部 I/O）だけをスパイで受け止めて「警告したか」を検証する。
 */
const OPTIONS = { fallback: 10, max: 50 };

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe('parsePositiveIntEnv', () => {
  describe('正常系', () => {
    it('範囲内の整数文字列をその値として返す', () => {
      expect(parsePositiveIntEnv('X', '3', OPTIONS)).toBe(3);
      expect(warn).not.toHaveBeenCalled();
    });

    it('前後の空白は取り除いて解釈する', () => {
      expect(parsePositiveIntEnv('X', ' 25 ', OPTIONS)).toBe(25);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('準正常系', () => {
    it('未設定なら警告せずに既定値を返す', () => {
      expect(parsePositiveIntEnv('X', undefined, OPTIONS)).toBe(10);
      expect(warn).not.toHaveBeenCalled();
    });

    it('空文字（`X=` と書いた場合）も未設定として扱う', () => {
      expect(parsePositiveIntEnv('X', '', OPTIONS)).toBe(10);
      expect(parsePositiveIntEnv('X', '   ', OPTIONS)).toBe(10);
      expect(warn).not.toHaveBeenCalled();
    });

    it('下限の 1 と上限の max はそのまま受け付ける', () => {
      expect(parsePositiveIntEnv('X', '1', OPTIONS)).toBe(1);
      expect(parsePositiveIntEnv('X', '50', OPTIONS)).toBe(50);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('異常系', () => {
    it.each([
      ['数値でない文字列', 'abc'],
      ['0（ループが 1 回も回らない）', '0'],
      ['負数', '-1'],
      ['小数（parseInt なら 1 に丸めて通る）', '1.5'],
      ['数字の後ろに文字（parseInt なら 10 として通る）', '10abc'],
      ['指数表記', '1e1'],
      ['上限超過', '51'],
      ['安全な整数の範囲を超える桁数', '99999999999999999999'],
    ])('%s は既定値に戻して警告する', (_label, raw) => {
      expect(parsePositiveIntEnv('AGENT_MAX_TOOL_ROUNDS', raw, OPTIONS)).toBe(
        10
      );
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('AGENT_MAX_TOOL_ROUNDS');
    });
  });
});
