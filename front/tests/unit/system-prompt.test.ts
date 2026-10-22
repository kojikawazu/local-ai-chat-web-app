import { describe, it, expect } from 'vitest';
import {
  buildSystemPrompt,
  CUSTOM_ROLE_LABEL,
  getRoleLabel,
  NO_ROLE_LABEL,
  ROLE_PRESETS,
} from '@/lib/system-prompt';
import { AGENT_PROMPT_PRESETS } from '@/lib/agent-prompts';
import { withSystemPrompt } from '@/lib/ollama';
import {
  MAX_CONVERSATION_SYSTEM_PROMPT_LENGTH,
  MAX_SYSTEM_PROMPT_LENGTH,
} from '@/lib/validation';

/**
 * 会話の役割（システムプロンプト。#10）の UT。
 * クライアント側の組み立て（`lib/system-prompt`）と、サーバー側で会話履歴の先頭に付ける処理
 * （`lib/ollama` の `withSystemPrompt`）を確かめる。どちらも純関数のため mock は使わない。
 */

describe('buildSystemPrompt', () => {
  describe('正常系', () => {
    it('会話の役割を先に、エージェントのプリセットを後に、空行で区切って連結する', () => {
      expect(
        buildSystemPrompt('あなたは翻訳者です。', '調べてから答える')
      ).toBe('あなたは翻訳者です。\n\n調べてから答える');
    });

    it('役割だけ（通常モード）なら役割をそのまま返す', () => {
      expect(buildSystemPrompt('あなたは翻訳者です。', '')).toBe(
        'あなたは翻訳者です。'
      );
    });
  });

  describe('準正常系', () => {
    it('役割が無く、エージェントのプリセットだけならプリセットを返す（従来の動き）', () => {
      expect(buildSystemPrompt('', '調べてから答える')).toBe(
        '調べてから答える'
      );
    });

    it('どちらも空なら空文字（API へ送らない）', () => {
      expect(buildSystemPrompt('', '')).toBe('');
    });
  });

  describe('異常系', () => {
    it('空白だけの部分は無いものとして扱い、前後の空白も除く', () => {
      expect(buildSystemPrompt('  \n ', ' 調べる ')).toBe('調べる');
    });
  });
});

describe('getRoleLabel', () => {
  describe('正常系', () => {
    it.each(ROLE_PRESETS.map((preset) => [preset.name, preset.prompt]))(
      'プリセット（%s）の本文ならその名前を返す',
      (name, prompt) => {
        expect(getRoleLabel(prompt)).toBe(name);
      }
    );
  });

  describe('準正常系', () => {
    it('プリセットを書き換えた本文は「カスタム」', () => {
      expect(getRoleLabel(`${ROLE_PRESETS[0].prompt}敬語で。`)).toBe(
        CUSTOM_ROLE_LABEL
      );
    });

    it('前後の空白はプリセットとの照合に影響しない', () => {
      expect(getRoleLabel(`\n${ROLE_PRESETS[0].prompt} `)).toBe(
        ROLE_PRESETS[0].name
      );
    });
  });

  describe('異常系', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['空文字', ''],
      ['空白のみ', '  '],
    ])('%sなら「役割なし」', (_label, prompt) => {
      expect(getRoleLabel(prompt)).toBe(NO_ROLE_LABEL);
    });
  });
});

describe('役割の上限とプリセットの不変条件', () => {
  describe('正常系', () => {
    it('上限いっぱいの役割に最長のエージェントのプリセットを連結しても /api/chat の上限に収まる', () => {
      const longestAgentPrompt = Math.max(
        ...AGENT_PROMPT_PRESETS.map((preset) => preset.prompt.length)
      );
      const combined = buildSystemPrompt(
        'あ'.repeat(MAX_CONVERSATION_SYSTEM_PROMPT_LENGTH),
        'い'.repeat(longestAgentPrompt)
      );
      expect(combined.length).toBeLessThanOrEqual(MAX_SYSTEM_PROMPT_LENGTH);
    });
  });

  describe('準正常系', () => {
    it('プリセットの ID・名前は重複しない', () => {
      expect(new Set(ROLE_PRESETS.map((p) => p.id)).size).toBe(
        ROLE_PRESETS.length
      );
      expect(new Set(ROLE_PRESETS.map((p) => p.name)).size).toBe(
        ROLE_PRESETS.length
      );
    });
  });

  describe('異常系', () => {
    it('どのプリセットも本文が空でなく、前後に空白が無く、役割の上限に収まる（保存時の整形で表示名が変わらない）', () => {
      for (const preset of ROLE_PRESETS) {
        expect(preset.prompt).not.toBe('');
        expect(preset.prompt).toBe(preset.prompt.trim());
        expect(preset.prompt.length).toBeLessThanOrEqual(
          MAX_CONVERSATION_SYSTEM_PROMPT_LENGTH
        );
      }
    });
  });
});

describe('withSystemPrompt', () => {
  const history = [{ role: 'user' as const, content: 'こんにちは' }];

  describe('正常系', () => {
    it('会話履歴の先頭に system メッセージを付ける', () => {
      expect(withSystemPrompt(history, 'あなたは翻訳者です。')).toEqual([
        { role: 'system', content: 'あなたは翻訳者です。' },
        { role: 'user', content: 'こんにちは' },
      ]);
    });
  });

  describe('準正常系', () => {
    it.each([
      ['未指定', undefined],
      ['空文字', ''],
      ['空白のみ', ' \n '],
    ])('システムプロンプトが%sなら付けない', (_label, prompt) => {
      expect(withSystemPrompt(history, prompt)).toEqual(history);
    });
  });

  describe('異常系', () => {
    it('渡した配列は書き換えない（呼び出し側の履歴に system を混ぜない）', () => {
      const input = [...history];
      const result = withSystemPrompt(input, '役割');
      expect(input).toEqual(history);
      expect(result).not.toBe(input);
    });
  });
});
