import { describe, it, expect, vi } from 'vitest';
import {
  addInstruction,
  hasInstructions,
  onInstruction,
  registerResponse,
  takeInstructions,
  unregisterResponse,
} from '@/lib/agent/instructions';
import { buildAgentTimeline } from '@/lib/chat/agent-timeline';
import { toConversationHistory } from '@/lib/chat/conversation-history';
import {
  buildMessageMetadata,
  parseMessageMetadata,
} from '@/lib/chat/message-metadata';
import { parseInstructionBody } from '@/lib/server/request-body';
import { delegationOutput, SUB_AGENTS } from '@/lib/agent/sub-agents';
import {
  MAX_INSTRUCTION_LENGTH,
  MAX_INSTRUCTIONS_PER_RESPONSE,
} from '@/lib/shared/validation';
import type { ToolCallInfo } from '@/types/agent/tool-call';
import type { Message } from '@/types/chat/message';

/**
 * 応答の途中の指示（割り込み。#241。`docs/30-agent-interrupt.md`）の純ロジックの UT。
 *
 * 受け箱（応答ごとの指示のため方・取り出し・届いたことの知らせ）・指示のボディの検証・時系列への並べ方・次の会話の履歴への足し方・
 * 保存の形と検証を確かめる。ループでの反映（区切りで読む・本文の後も続ける・サブエージェントのまとめ始め）は IT
 * （chat-agent-instruction.test.ts）が担う。
 */

/** 本文の位置付きのツールの記録 */
function tool(name: string, contentOffset: number): ToolCallInfo {
  return {
    name,
    arguments: {},
    result: '',
    isError: false,
    durationMs: 0,
    contentOffset,
  };
}

/**
 * 質問と、指示を持つ応答の 2 つのメッセージを作る。
 *
 * @param instructions - 応答の途中の指示
 * @returns メッセージ一覧
 */
function exchange(
  instructions: NonNullable<Message['metadata']>['instructions']
): Message[] {
  return [
    { id: 'u1', role: 'user', content: '調べて', createdAt: new Date(0) },
    {
      id: 'a1',
      role: 'assistant',
      content: '答え',
      createdAt: new Date(0),
      metadata: { instructions },
    },
  ];
}

describe('受け箱', () => {
  describe('正常系', () => {
    it('入れた指示を届いた順に取り出し、取り出したら空になる', () => {
      const id = crypto.randomUUID();
      registerResponse(id);
      const first = addInstruction(id, '日本語の出典だけ');
      const second = addInstruction(id, '3 行で');
      expect(first.ok && second.ok).toBe(true);
      expect(hasInstructions(id)).toBe(true);
      expect(takeInstructions(id).map((item) => item.content)).toEqual([
        '日本語の出典だけ',
        '3 行で',
      ]);
      expect(hasInstructions(id)).toBe(false);
      expect(takeInstructions(id)).toEqual([]);
      unregisterResponse(id);
    });

    it('指示が届いたら、登録したものに知らせる（外した後は知らせない）', () => {
      const id = crypto.randomUUID();
      registerResponse(id);
      const listener = vi.fn();
      const stop = onInstruction(id, listener);
      addInstruction(id, 'a');
      expect(listener).toHaveBeenCalledTimes(1);
      stop();
      addInstruction(id, 'b');
      expect(listener).toHaveBeenCalledTimes(1);
      unregisterResponse(id);
    });
  });

  describe('準正常系', () => {
    it(`1 回の応答で ${MAX_INSTRUCTIONS_PER_RESPONSE} 件まで（読んだ分も数える）`, () => {
      const id = crypto.randomUUID();
      registerResponse(id);
      for (let i = 0; i < MAX_INSTRUCTIONS_PER_RESPONSE; i++) {
        expect(addInstruction(id, `指示 ${i}`).ok).toBe(true);
        takeInstructions(id);
      }
      expect(addInstruction(id, 'もう 1 つ')).toEqual({
        ok: false,
        reason: 'limit',
      });
      unregisterResponse(id);
    });
  });

  describe('異常系', () => {
    it('知らない応答・終わった応答には入れられない', () => {
      const id = crypto.randomUUID();
      expect(addInstruction(id, 'a')).toEqual({
        ok: false,
        reason: 'not_found',
      });
      registerResponse(id);
      unregisterResponse(id);
      expect(addInstruction(id, 'a')).toEqual({
        ok: false,
        reason: 'not_found',
      });
      expect(takeInstructions(id)).toEqual([]);
      expect(onInstruction(id, () => {})).toBeTypeOf('function');
    });
  });
});

describe('指示のボディの検証', () => {
  describe('正常系', () => {
    it('前後の空白を除いた本文にする', () => {
      expect(parseInstructionBody({ content: '  3 行で  ' })).toEqual({
        ok: true,
        value: { content: '3 行で' },
      });
    });
  });

  describe('準正常系', () => {
    it(`${MAX_INSTRUCTION_LENGTH} 文字ちょうどは受け付ける`, () => {
      expect(
        parseInstructionBody({ content: 'あ'.repeat(MAX_INSTRUCTION_LENGTH) })
          .ok
      ).toBe(true);
    });
  });

  describe('異常系', () => {
    it.each([
      [null, 'JSONオブジェクトで指定してください'],
      [{ content: 1 }, 'contentは文字列で指定してください'],
      [{ content: '   ' }, '指示を入力してください'],
      [
        { content: 'あ'.repeat(MAX_INSTRUCTION_LENGTH + 1) },
        '指示は2,000文字以内で入力してください',
      ],
    ])('%j は失敗にする', (body, error) => {
      const result = parseInstructionBody(body);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain(error);
    });
  });
});

describe('時系列・履歴・保存', () => {
  describe('正常系', () => {
    it('読まれた指示を、読んだ位置（同じ位置のツールの後）に並べる', () => {
      const content = '調べます。答えです。';
      const timeline = buildAgentTimeline(
        content,
        [tool('web_search', 5), tool('url_fetch', 5)],
        [{ content: '日本語だけ', contentOffset: 5, toolCallIndex: 1 }]
      );
      expect(timeline?.steps.map((step) => step.kind)).toEqual([
        'text',
        'tools',
        'instruction',
        'tools',
      ]);
      expect(timeline?.answer).toBe('答えです。');
    });

    it('ツールを呼ばずに答え直した応答も、指示で区切って並べる', () => {
      const timeline = buildAgentTimeline(
        '前の答え。直した答え。',
        [],
        [{ content: '短く', contentOffset: 5, toolCallIndex: 0 }]
      );
      expect(timeline).toEqual({
        steps: [
          { kind: 'text', text: '前の答え。' },
          { kind: 'instruction', content: '短く' },
        ],
        answer: '直した答え。',
      });
    });

    it('次の会話の履歴では、読まれた指示を直前の質問の後ろに足す', () => {
      const history = toConversationHistory(
        exchange([
          { content: '日本語だけ', contentOffset: 3 },
          { content: '3 行で', contentOffset: 9 },
        ])
      );
      expect(history[0].content).toBe(
        '調べて\n\n（応答の途中で足した指示）\n- 日本語だけ\n- 3 行で'
      );
      expect(history[1].content).toBe('答え');
    });

    it('保存の形では画面だけの印を外し、読み直すと同じ形に戻る', () => {
      const metadata = buildMessageMetadata({
        instructions: [
          {
            id: 'x',
            content: '日本語だけ',
            contentOffset: 3,
            toolCallIndex: 1,
          },
          { id: 'y', content: '3 行で', pending: true },
        ],
      });
      expect(metadata?.instructions).toEqual([
        { content: '日本語だけ', contentOffset: 3, toolCallIndex: 1 },
        { content: '3 行で', unread: true },
      ]);
      expect(parseMessageMetadata(metadata)?.instructions).toEqual(
        metadata?.instructions
      );
    });

    it('サブエージェントが指示でまとめたら、要約に理由を書く', () => {
      const output = delegationOutput(SUB_AGENTS[0], '仕事', {
        answer: '回答',
        toolCalls: [],
        rounds: 1,
        limit: 'instruction',
      });
      expect(output.summary).toBe('ツール 0 回（追加の指示でまとめた）');
    });
  });

  describe('準正常系', () => {
    it('読まれなかった指示は時系列にも履歴にも入れない', () => {
      expect(
        buildAgentTimeline('答え', [], [{ content: 'x', unread: true }])
      ).toBeNull();
      expect(
        toConversationHistory(exchange([{ content: 'x', unread: true }]))[0]
          .content
      ).toBe('調べて');
    });
  });

  describe('異常系', () => {
    it('形の合わない保存済みの指示を捨て、位置の無いものは読まれなかったにする', () => {
      expect(
        parseMessageMetadata({
          instructions: [
            { content: '' },
            { content: 1 },
            'x',
            { content: '位置が不正', contentOffset: -1, toolCallIndex: 2 },
            { content: '正しい', contentOffset: 4, toolCallIndex: 0 },
          ],
        })?.instructions
      ).toEqual([
        { content: '位置が不正', unread: true },
        { content: '正しい', contentOffset: 4, toolCallIndex: 0 },
      ]);
    });
  });
});
