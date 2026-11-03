import { describe, it, expect } from 'vitest';
import {
  finishSubAgentStep,
  finishToolCall,
  firstPendingToolCall,
  startSubAgentStep,
  startToolCall,
  updateMessageToolCalls,
  updateToolCallStatus,
} from '@/lib/chat/tool-call-progress';
import type { ToolCallInfo } from '@/types/agent/tool-call';
import type { Message } from '@/types/chat/message';

/**
 * 結果が届く前のツール呼び出しの状態（#192）の純ロジックの UT。
 * 実行中・承認待ちの表示（スピナー・⏳）は E2E（command-approval.spec.ts・file-write-approval.spec.ts）が担う。
 */

/**
 * 実行中の仮の記録を、順に足した記録を作る。
 *
 * @param names - 呼んだツール名（呼んだ順）
 * @returns 仮の記録
 */
function started(...names: string[]): ToolCallInfo[] {
  return names.reduce<ToolCallInfo[]>(
    (calls, name, i) =>
      startToolCall(calls, { name, arguments: { i }, contentOffset: 0 }),
    []
  );
}

const OUTCOME = {
  result: '書き込みました',
  isError: false,
  summary: 'a.txt を編集（+1 −1）',
  approval: 'approved' as const,
};

describe('startToolCall', () => {
  describe('正常系', () => {
    it('結果の無い「実行中」の仮の記録を足す（✅ の材料になる isError: false でも status で区別できる）', () => {
      const calls = startToolCall([], {
        name: 'run_command',
        arguments: { command: 'git status' },
        contentOffset: 12,
      });
      expect(calls).toEqual([
        {
          name: 'run_command',
          arguments: { command: 'git status' },
          contentOffset: 12,
          result: '',
          isError: false,
          durationMs: 0,
          status: 'running',
        },
      ]);
    });
  });

  describe('準正常系', () => {
    it('元の配列は変えない', () => {
      const before = started('read_file');
      const after = startToolCall(before, {
        name: 'edit_file',
        arguments: {},
        contentOffset: 0,
      });
      expect(before).toHaveLength(1);
      expect(after).toHaveLength(2);
    });
  });

  // 異常系: 渡した記録に 1 件足すだけで、失敗する入力が無い
});

describe('updateToolCallStatus', () => {
  describe('正常系', () => {
    it('承認の依頼が届いたら、同じ名前の実行中の記録を承認待ちにし、答えたら実行中に戻す', () => {
      const waiting = updateToolCallStatus(
        started('read_file', 'edit_file'),
        'edit_file',
        'running',
        'awaiting-approval'
      );
      expect(waiting.map((call) => call.status)).toEqual([
        'running',
        'awaiting-approval',
      ]);

      const answered = updateToolCallStatus(
        waiting,
        'edit_file',
        'awaiting-approval',
        'running'
      );
      expect(answered[1].status).toBe('running');
    });
  });

  describe('準正常系', () => {
    it('同じ名前が続けて呼ばれたら、まだその状態にある最初の記録から順に変える', () => {
      const once = updateToolCallStatus(
        started('run_command', 'run_command'),
        'run_command',
        'running',
        'awaiting-approval'
      );
      expect(once.map((call) => call.status)).toEqual([
        'awaiting-approval',
        'running',
      ]);
      const twice = updateToolCallStatus(
        once,
        'run_command',
        'running',
        'awaiting-approval'
      );
      expect(twice.map((call) => call.status)).toEqual([
        'awaiting-approval',
        'awaiting-approval',
      ]);
    });
  });

  describe('異常系', () => {
    it('対象が無ければ（別の名前・結果が届いた後）元の配列をそのまま返す', () => {
      const calls = started('read_file');
      expect(
        updateToolCallStatus(calls, 'edit_file', 'running', 'awaiting-approval')
      ).toBe(calls);
      const finished = finishToolCall(calls, 'read_file', OUTCOME);
      expect(
        updateToolCallStatus(
          finished,
          'read_file',
          'running',
          'awaiting-approval'
        )
      ).toBe(finished);
    });
  });
});

describe('finishToolCall', () => {
  describe('正常系', () => {
    it('仮の記録に結果を入れ、状態を消す（引数・本文の位置は残す）', () => {
      const calls = updateToolCallStatus(
        started('edit_file'),
        'edit_file',
        'running',
        'awaiting-approval'
      );
      const [finished] = finishToolCall(calls, 'edit_file', OUTCOME);
      expect(finished).toEqual({
        name: 'edit_file',
        arguments: { i: 0 },
        contentOffset: 0,
        durationMs: 0,
        ...OUTCOME,
      });
      expect(finished).not.toHaveProperty('status');
    });
  });

  describe('準正常系', () => {
    it('同じ名前が続けて呼ばれたら、結果の届いていない最初の記録から順に入れる', () => {
      let calls = started('web_search', 'web_search');
      calls = finishToolCall(calls, 'web_search', {
        ...OUTCOME,
        summary: '1 つ目',
      });
      expect(calls.map((call) => call.summary)).toEqual(['1 つ目', undefined]);
      expect(calls[1].status).toBe('running');

      calls = finishToolCall(calls, 'web_search', {
        ...OUTCOME,
        summary: '2 つ目',
      });
      expect(calls.map((call) => call.summary)).toEqual(['1 つ目', '2 つ目']);
      expect(calls.every((call) => call.status === undefined)).toBe(true);
    });

    it('結果の届いていない記録が無ければ、同じ名前の最後の記録に入れる（#192 より前の動き）', () => {
      const done = finishToolCall(started('calculate'), 'calculate', OUTCOME);
      const again = finishToolCall(done, 'calculate', {
        ...OUTCOME,
        summary: '後から届いた結果',
      });
      expect(again[0].summary).toBe('後から届いた結果');
    });
  });

  describe('異常系', () => {
    it('同じ名前の記録が無ければ、元の配列をそのまま返す', () => {
      const calls = started('read_file');
      expect(finishToolCall(calls, 'run_command', OUTCOME)).toBe(calls);
    });
  });
});

describe('updateMessageToolCalls', () => {
  const messages: Message[] = [
    {
      id: 'u1',
      role: 'user',
      content: '直して',
      createdAt: new Date(0),
    },
    {
      id: 'a1',
      role: 'assistant',
      content: '',
      createdAt: new Date(0),
      metadata: { thinkingText: '考え中' },
    },
  ];

  describe('正常系', () => {
    it('対象のメッセージだけの記録を差し替え、ほかの metadata は残す', () => {
      const updated = updateMessageToolCalls(messages, 'a1', (calls) =>
        startToolCall(calls, {
          name: 'run_command',
          arguments: {},
          contentOffset: 0,
        })
      );
      expect(updated[0]).toBe(messages[0]);
      expect(updated[1].metadata).toMatchObject({
        thinkingText: '考え中',
        toolCalls: [{ name: 'run_command', status: 'running' }],
      });
    });
  });

  describe('準正常系', () => {
    it('記録をまだ持たないメッセージには、空の記録から作る', () => {
      const seen: ToolCallInfo[][] = [];
      updateMessageToolCalls(messages, 'a1', (calls) => {
        seen.push(calls);
        return calls;
      });
      expect(seen).toEqual([[]]);
    });
  });

  describe('異常系', () => {
    it('対象のメッセージが無ければ、どのメッセージも変えない', () => {
      const updated = updateMessageToolCalls(messages, 'missing', () => []);
      expect(updated).toEqual(messages);
    });
  });
});

describe('firstPendingToolCall', () => {
  /**
   * ツールの記録を持つ応答を 1 つ作る。
   *
   * @param toolCalls - 応答のツールの記録
   * @returns メッセージ一覧
   */
  function answer(toolCalls: ToolCallInfo[]): Message[] {
    return [
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        createdAt: new Date(0),
        metadata: { toolCalls },
      },
    ];
  }

  describe('正常系', () => {
    it('結果の届いていない最初の呼び出しを返す（順に実行するツールで、順番待ちのものを実行中と見せない。#26）', () => {
      const calls = started('delegate_to_agent', 'delegate_to_agent');
      expect(firstPendingToolCall(answer(calls), 'a1')).toEqual({
        name: 'delegate_to_agent',
        arguments: { i: 0 },
      });
    });

    it('最初の結果が届いたら、次のまだの呼び出しを返す', () => {
      const calls = finishToolCall(
        started('delegate_to_agent', 'delegate_to_agent'),
        'delegate_to_agent',
        OUTCOME
      );
      expect(firstPendingToolCall(answer(calls), 'a1')).toEqual({
        name: 'delegate_to_agent',
        arguments: { i: 1 },
      });
    });
  });

  describe('準正常系', () => {
    it('承認待ちの呼び出しも、まだのものとして返す', () => {
      const calls = updateToolCallStatus(
        started('write_file'),
        'write_file',
        'running',
        'awaiting-approval'
      );
      expect(firstPendingToolCall(answer(calls), 'a1')?.name).toBe(
        'write_file'
      );
    });

    it('すべて結果が届いていれば null', () => {
      const calls = finishToolCall(
        started('web_search'),
        'web_search',
        OUTCOME
      );
      expect(firstPendingToolCall(answer(calls), 'a1')).toBeNull();
    });
  });

  describe('異常系', () => {
    it('メッセージが無い・記録が無ければ null', () => {
      expect(firstPendingToolCall(answer([]), 'a1')).toBeNull();
      expect(firstPendingToolCall([], 'missing')).toBeNull();
    });
  });
});

describe('呼び出しの ID と順番待ち・サブエージェントの中の手順（#26 Phase B）', () => {
  /**
   * 呼び出しの ID 付きで仮の記録を足す。
   *
   * @param calls - 名前と ID（順番待ちなら queued）
   * @returns 仮の記録
   */
  function startedWithIds(
    ...calls: {
      name: string;
      callId: string;
      queued?: boolean;
      args?: Record<string, unknown>;
    }[]
  ): ToolCallInfo[] {
    return calls.reduce<ToolCallInfo[]>(
      (acc, call) =>
        startToolCall(
          acc,
          {
            name: call.name,
            arguments: call.args ?? {},
            contentOffset: 0,
            callId: call.callId,
          },
          call.queued
        ),
      []
    );
  }

  const DELEGATION_ARGS = { agent: 'researcher', task: '調べて' };

  describe('正常系', () => {
    it('同じ名前のツールでも、呼び出しの ID で結果を当てる（後に呼んだものの結果が先に届いても取り違えない）', () => {
      const calls = startedWithIds(
        { name: 'web_search', callId: 'a' },
        { name: 'web_search', callId: 'b' }
      );
      const finished = finishToolCall(calls, 'web_search', OUTCOME, 'b');
      expect(finished.map((c) => c.status)).toEqual(['running', undefined]);
      // 結果の届いた記録からは、画面だけの印（状態・ID）を外す
      expect(finished[1]).not.toHaveProperty('callId');
    });

    it('順番待ちで足し、動き始めたら実行中にする', () => {
      const calls = startedWithIds(
        { name: 'delegate_to_agent', callId: 'a' },
        { name: 'delegate_to_agent', callId: 'b', queued: true }
      );
      expect(calls.map((c) => c.status)).toEqual(['running', 'queued']);
      const begun = updateToolCallStatus(calls, '', 'queued', 'running', 'b');
      expect(begun.map((c) => c.status)).toEqual(['running', 'running']);
    });

    it('委譲の記録に中の手順を足し、結果を入れ、下の表示に今の手順を出す', () => {
      let calls = startedWithIds({
        name: 'delegate_to_agent',
        callId: 'd',
        args: DELEGATION_ARGS,
      });
      calls = startSubAgentStep(calls, 'd', {
        stepId: 's1',
        name: 'web_search',
        arguments: { query: 'Next.js 16' },
      });
      expect(calls[0].subAgent).toMatchObject({
        agent: 'researcher',
        task: '調べて',
        toolCalls: [{ name: 'web_search', status: 'running', callId: 's1' }],
      });
      expect(firstPendingToolCall(answerOf(calls), 'a1')).toEqual({
        name: 'delegate_to_agent',
        arguments: DELEGATION_ARGS,
        currentStep: { name: 'web_search', arguments: { query: 'Next.js 16' } },
      });

      calls = finishSubAgentStep(calls, 'd', 's1', {
        result: '一覧',
        isError: false,
        summary: '5 件',
        durationMs: 300,
      });
      expect(calls[0].subAgent?.toolCalls).toEqual([
        {
          name: 'web_search',
          arguments: { query: 'Next.js 16' },
          result: '一覧',
          isError: false,
          summary: '5 件',
          durationMs: 300,
        },
      ]);
      // 中の手順が終わったら、今の手順は出さない（委譲はまだ実行中）
      expect(firstPendingToolCall(answerOf(calls), 'a1')).toEqual({
        name: 'delegate_to_agent',
        arguments: DELEGATION_ARGS,
      });
    });
  });

  describe('準正常系', () => {
    it('順番待ちの委譲より前の、実行中の委譲を下の表示に出す', () => {
      const calls = startedWithIds(
        {
          name: 'delegate_to_agent',
          callId: 'a',
          args: { agent: 'researcher', task: 'A' },
        },
        {
          name: 'delegate_to_agent',
          callId: 'b',
          queued: true,
          args: { agent: 'researcher', task: 'B' },
        }
      );
      expect(firstPendingToolCall(answerOf(calls), 'a1')?.arguments).toEqual({
        agent: 'researcher',
        task: 'A',
      });
    });

    it('並べて実行した中の手順は、それぞれの ID で結果を当てる', () => {
      let calls = startedWithIds({
        name: 'delegate_to_agent',
        callId: 'd',
        args: DELEGATION_ARGS,
      });
      for (const stepId of ['s1', 's2']) {
        calls = startSubAgentStep(calls, 'd', {
          stepId,
          name: 'url_fetch',
          arguments: { url: stepId },
        });
      }
      calls = finishSubAgentStep(calls, 'd', 's2', {
        result: '本文',
        isError: false,
        durationMs: 1,
      });
      expect(calls[0].subAgent?.toolCalls.map((t) => t.status)).toEqual([
        'running',
        undefined,
      ]);
    });
  });

  describe('異常系', () => {
    it('知らない呼び出し・中の手順の ID、任せた相手の分からない委譲は、記録を変えない', () => {
      const calls = startedWithIds({
        name: 'delegate_to_agent',
        callId: 'd',
        args: { agent: 'translator', task: 'x' },
      });
      const step = { stepId: 's', name: 'web_search', arguments: {} };
      expect(startSubAgentStep(calls, 'missing', step)).toBe(calls);
      expect(startSubAgentStep(calls, 'd', step)).toBe(calls);
      expect(
        finishSubAgentStep(calls, 'd', 'missing', {
          result: '',
          isError: false,
          durationMs: 0,
        })
      ).toBe(calls);
      expect(
        updateToolCallStatus(calls, '', 'queued', 'running', 'missing')
      ).toBe(calls);
    });
  });
});

/**
 * ツールの記録を持つ応答を 1 つ作る（呼び出しの ID と順番待ちのテスト用）。
 *
 * @param toolCalls - 応答のツールの記録
 * @returns メッセージ一覧
 */
function answerOf(toolCalls: ToolCallInfo[]): Message[] {
  return [
    {
      id: 'a1',
      role: 'assistant',
      content: '',
      createdAt: new Date(0),
      metadata: { toolCalls },
    },
  ];
}
