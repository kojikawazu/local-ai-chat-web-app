import { describe, it, expect } from 'vitest';
import {
  AGENT_PROMPT_PRESETS,
  DEFAULT_PRESET_ID,
  getPresetById,
} from '@/lib/agent-prompts';

/**
 * `agent-prompts` の UT。純粋な配列探索のため mock は使わない。
 * 契約: `getPresetById` は完全一致で検索し、未一致は `undefined` を返す。
 */
describe('getPresetById', () => {
  describe('正常系', () => {
    it('既存 ID（researcher）に一致するプリセットを返す', () => {
      const preset = getPresetById('researcher');
      expect(preset?.id).toBe('researcher');
      expect(preset?.prompt.length).toBeGreaterThan(0);
    });

    it('全プリセット ID が取得できる', () => {
      for (const p of AGENT_PROMPT_PRESETS) {
        expect(getPresetById(p.id)).toBe(p);
      }
    });
  });

  describe('準正常系', () => {
    it('none プリセットは存在するが prompt が空文字（境界値）', () => {
      const none = getPresetById('none');
      expect(none).toBeDefined();
      expect(none?.prompt).toBe('');
    });
  });

  describe('異常系', () => {
    it('未知の ID は undefined を返す', () => {
      expect(getPresetById('unknown-id')).toBeUndefined();
    });

    it('空文字は undefined を返す', () => {
      expect(getPresetById('')).toBeUndefined();
    });

    it('大文字小文字が異なると一致しない（完全一致で検索する）', () => {
      expect(getPresetById('Researcher')).toBeUndefined();
    });
  });
});

describe('プリセット定義の不変条件', () => {
  describe('正常系', () => {
    it('デフォルト ID が実在するプリセットを指す', () => {
      expect(getPresetById(DEFAULT_PRESET_ID)).toBeDefined();
      expect(DEFAULT_PRESET_ID).toBe('researcher');
    });

    it('プリセット ID は重複しない', () => {
      const ids = AGENT_PROMPT_PRESETS.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
