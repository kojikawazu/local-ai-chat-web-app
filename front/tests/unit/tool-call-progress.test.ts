import { describe, it, expect } from 'vitest';
import {
  finishToolCall,
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
