import { describe, it, expect } from 'vitest';
import {
  buildMessageMetadata,
  parseMessageMetadata,
} from '@/lib/message-metadata';

/**
 * `message-metadata` の UT。純関数のため mock は使わない。
 * 契約: `buildMessageMetadata` は値のある項目だけを含め、無ければ `null`。
 * `parseMessageMetadata` は外部入力を項目ごとに検証し、不正な項目だけを捨てる。
 */
const TOOL_CALL = {
  name: 'get_current_datetime',
  arguments: { timezone: 'Asia/Tokyo' },
  result: '2026-10-17T21:25:52+09:00',
  isError: false,
  durationMs: 1,
};

describe('buildMessageMetadata', () => {
  describe('正常系', () => {
    it('4 項目すべてを含めて返す', () => {
      expect(
        buildMessageMetadata({
          toolCalls: [TOOL_CALL],
          thinkingText: '時刻を調べる',
          agentRounds: 2,
          agentDurationMs: 14800,
        })
      ).toEqual({
        toolCalls: [TOOL_CALL],
        thinkingText: '時刻を調べる',
        agentRounds: 2,
        agentDurationMs: 14800,
      });
    });
  });

  describe('準正常系', () => {
    it('ツール呼び出しが無く思考過程だけでも metadata を返す（#94）', () => {
      expect(
        buildMessageMetadata({
          toolCalls: [],
          thinkingText: '挨拶を返す',
          agentRounds: 1,
          agentDurationMs: 3000,
        })
      ).toEqual({
        thinkingText: '挨拶を返す',
        agentRounds: 1,
        agentDurationMs: 3000,
      });
    });

    it('所要時間 0 は値として残す（0 を「無い」と扱わない）', () => {
      expect(buildMessageMetadata({ agentDurationMs: 0 })).toEqual({
        agentDurationMs: 0,
      });
    });

    it('通常チャットの応答を停止した場合も、中断マークだけの metadata を返す（#8）', () => {
      expect(buildMessageMetadata({ interrupted: true })).toEqual({
        interrupted: true,
      });
    });
  });

  describe('異常系', () => {
    it('値のある項目が 1 つも無ければ null（通常チャットの応答）', () => {
      expect(
        buildMessageMetadata({
          toolCalls: [],
          thinkingText: '',
          agentRounds: undefined,
          agentDurationMs: undefined,
        })
      ).toBeNull();
    });

    it('停止していない応答（interrupted: false）は中断マークを持たせない', () => {
      expect(buildMessageMetadata({ interrupted: false })).toBeNull();
    });
  });
});

describe('parseMessageMetadata', () => {
  describe('正常系', () => {
    it('保存した 4 項目をそのまま復元する', () => {
      const saved = {
        toolCalls: [TOOL_CALL],
        thinkingText: '時刻を調べる',
        agentRounds: 2,
        agentDurationMs: 14800,
      };
      expect(parseMessageMetadata(saved)).toEqual(saved);
    });

    it('ツール呼び出しの要約・空の結果・失敗を復元する（#150）', () => {
      const toolCalls = [
        { ...TOOL_CALL, name: 'web_search', summary: '5 件' },
        { ...TOOL_CALL, name: 'web_search', summary: '0 件', isEmpty: true },
        {
          ...TOOL_CALL,
          name: 'url_fetch',
          result: 'エラー: HTTP 404 Not Found',
          isError: true,
          summary: 'HTTP 404 Not Found',
        },
      ];
      expect(parseMessageMetadata({ toolCalls })).toEqual({ toolCalls });
    });

    it('中断マークを復元する（#8）', () => {
      expect(
        parseMessageMetadata({ thinkingText: '考えた', interrupted: true })
      ).toEqual({ thinkingText: '考えた', interrupted: true });
    });
  });

  describe('準正常系', () => {
    it('ツール呼び出しの欠けた項目は既定値で補う（古いデータ）', () => {
      expect(
        parseMessageMetadata({
          toolCalls: [{ name: 'calculate', result: '4' }],
        })
      ).toEqual({
        toolCalls: [
          {
            name: 'calculate',
            result: '4',
            arguments: {},
            isError: false,
            durationMs: 0,
          },
        ],
      });
    });

    it('型が不正な項目だけを捨て、残りは復元する', () => {
      expect(
        parseMessageMetadata({
          toolCalls: 'oops',
          thinkingText: '考えた',
          agentRounds: 1.5,
          agentDurationMs: -1,
        })
      ).toEqual({ thinkingText: '考えた' });
    });

    it('中断マークは true のときだけ復元する（"true" などの文字列は捨てる）', () => {
      expect(
        parseMessageMetadata({ thinkingText: '考えた', interrupted: 'true' })
      ).toEqual({ thinkingText: '考えた' });
    });

    it('要約が空・文字列でない、空の結果が true でないなら、その項目だけを捨てる（#150）', () => {
      expect(
        parseMessageMetadata({
          toolCalls: [
            { ...TOOL_CALL, summary: '' },
            { ...TOOL_CALL, summary: 5, isEmpty: 'true' },
            { ...TOOL_CALL, isEmpty: false },
          ],
        })
      ).toEqual({ toolCalls: [TOOL_CALL, TOOL_CALL, TOOL_CALL] });
    });

    it('ツール呼び出しのうち名前か結果が文字列でないものだけを捨てる', () => {
      expect(
        parseMessageMetadata({
          toolCalls: [TOOL_CALL, { name: 'calculate' }, { result: '4' }, null],
        })
      ).toEqual({ toolCalls: [TOOL_CALL] });
    });
  });

  describe('異常系', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['配列', [TOOL_CALL]],
      ['文字列', 'metadata'],
      ['数値', 1],
    ])('オブジェクトでない値（%s）は null', (_label, value) => {
      expect(parseMessageMetadata(value)).toBeNull();
    });

    it('有効な項目が 1 つも無ければ null', () => {
      expect(
        parseMessageMetadata({ toolCalls: [null], agentRounds: 0 })
      ).toBeNull();
    });
  });
});
