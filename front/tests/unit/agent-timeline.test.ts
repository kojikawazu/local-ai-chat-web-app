import { describe, it, expect } from 'vitest';
import { buildAgentTimeline } from '@/lib/chat/agent-timeline';
import { roundSeparator } from '@/lib/agent/agent';
import type { ToolCallInfo } from '@/types/agent/tool-call';

/**
 * エージェントの応答の時系列（#186）の UT。
 * 本文をツールの呼び出しの位置（contentOffset）で区切って「説明 → ツール → 回答」に並べる処理と、
 * ラウンドの区切りに入れる空行の決め方を確かめる。純関数のため mock は使わない。
 */

/**
 * テスト用のツール呼び出しを作る。
 *
 * @param name - ツール名
 * @param contentOffset - 呼んだ時点の本文の文字数（省略すると #186 より前の古いデータ）
 * @returns ツール呼び出しの記録
 */
function call(name: string, contentOffset?: number): ToolCallInfo {
  return {
    name,
    arguments: {},
    result: '結果',
    isError: false,
    durationMs: 1,
    ...(contentOffset !== undefined && { contentOffset }),
  };
}

describe('buildAgentTimeline', () => {
  describe('正常系', () => {
    it('説明 → ツール → 説明 → ツール → 回答の順に並べ、同じ位置のツールはまとめる', () => {
      const content = '確認します。\n\n中身を読みます。\n\n回答です。';
      const first = '確認します。\n\n'.length;
      const second = '確認します。\n\n中身を読みます。\n\n'.length;
      const a = call('list_directory', first);
      const b = call('list_directory', first);
      const c = call('read_file', second);

      expect(buildAgentTimeline(content, [a, b, c])).toEqual({
        steps: [
          { kind: 'text', text: '確認します。\n\n' },
          { kind: 'tools', toolCalls: [a, b] },
          { kind: 'text', text: '中身を読みます。\n\n' },
          { kind: 'tools', toolCalls: [c] },
        ],
        answer: '回答です。',
      });
    });

    it('本文より先にツールを呼んだら、ツールから始まる', () => {
      const tool = call('get_current_datetime', 0);
      expect(buildAgentTimeline('今は 21 時です', [tool])).toEqual({
        steps: [{ kind: 'tools', toolCalls: [tool] }],
        answer: '今は 21 時です',
      });
    });
  });

  describe('準正常系', () => {
    it('回答がまだ届いていない・空白だけなら、回答は空文字', () => {
      const tool = call('read_file', 6);
      expect(buildAgentTimeline('確認します。', [tool])?.answer).toBe('');
      expect(buildAgentTimeline('確認します。\n\n', [tool])?.answer).toBe('');
    });

    it('並びが前後した記録も位置の順に並べ、同じ位置なら渡した順を保つ', () => {
      const late = call('read_file', 3);
      const early1 = call('search_files', 0);
      const early2 = call('list_directory', 0);
      const timeline = buildAgentTimeline('abcdef', [late, early1, early2]);
      expect(timeline?.steps).toEqual([
        { kind: 'tools', toolCalls: [early1, early2] },
        { kind: 'text', text: 'abc' },
        { kind: 'tools', toolCalls: [late] },
      ]);
      expect(timeline?.answer).toBe('def');
    });

    it('ツールの呼び出しが無ければ null（通常の応答）', () => {
      expect(buildAgentTimeline('こんにちは', [])).toBeNull();
    });
  });

  describe('異常系', () => {
    it('位置を持たない古いデータが混ざれば null（従来の並びで出す）', () => {
      expect(
        buildAgentTimeline('本文', [call('calculate', 0), call('calculate')])
      ).toBeNull();
    });

    it('本文の長さを超える位置は末尾に寄せる', () => {
      const tool = call('read_file', 999);
      expect(buildAgentTimeline('短い', [tool])).toEqual({
        steps: [
          { kind: 'text', text: '短い' },
          { kind: 'tools', toolCalls: [tool] },
        ],
        answer: '',
      });
    });
  });
});

describe('roundSeparator', () => {
  describe('正常系', () => {
    it('改行で終わらない本文の後には空行を入れる', () => {
      expect(roundSeparator(6, 'す。')).toBe('\n\n');
    });
  });

  describe('準正常系', () => {
    it('改行 1 つで終わっていれば足りない改行だけ、空行で終わっていれば何も入れない', () => {
      expect(roundSeparator(7, '。\n')).toBe('\n');
      expect(roundSeparator(8, '\n\n')).toBe('');
    });

    it('まだ本文を送っていなければ入れない（ツールから始まる応答）', () => {
      expect(roundSeparator(0, '')).toBe('');
    });
  });

  // 異常系: 引数はエージェントループが数えた値だけで、不正な入力の経路が無い
});
