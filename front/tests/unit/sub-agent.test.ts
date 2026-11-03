import { describe, it, expect, vi } from 'vitest';
import {
  SUB_AGENTS,
  availableSubAgents,
  delegateDescription,
  delegationOutput,
  parseDelegateArgs,
  subAgentToolNames,
  truncateAnswer,
} from '@/lib/agent/sub-agents';
import type { SubAgentResult } from '@/lib/agent/sub-agents';
import type { Tool } from '@/lib/agent/tools/types';
import { createInOrderQueue, notOfferedToolOutput } from '@/lib/agent/agent';
import { parseMessageMetadata } from '@/lib/chat/message-metadata';
import {
  delegationRunningLabel,
  describeToolArguments,
  formatToolDuration,
  isDelegation,
  isSubAgentName,
  toolCallLabel,
} from '@/lib/chat/tool-label';
import {
  MAX_DELEGATE_TASK_CHARS,
  MAX_SUB_AGENT_ANSWER_CHARS,
} from '@/constants/agent/sub-agent';

/**
 * サブエージェント（#26。`docs/29-multi-agent.md`）の純ロジックの UT。
 *
 * 使えるサブエージェントの判定・渡すツール・委譲の引数の検証・回答の切り詰め・委譲の結果の組み立てと、
 * 画面の見出しの名前・引数の要約を確かめる。ループの配線（Ollama・ツールの実行）は IT（chat-agent-sub-agent.test.ts）が担う。
 */

/**
 * 登録済みのツールの代わり（名前と、承認・画像の有無だけを持つ）。
 *
 * @param name - ツール名
 * @param extra - `prepare`・`requiresVision` 等
 * @returns ツール。判定は名前と印だけを見るため、実行はしない
 */
function fakeTool(name: string, extra: Partial<Tool> = {}): Tool {
  return {
    definition: {
      name,
      description: name,
      parameters: { type: 'object', properties: {}, required: [] },
    },
    execute: async () => ({ result: '', isError: false }),
    ...extra,
  };
}

/**
 * 名前を並べた「登録済み」から引く関数を作る。
 *
 * @param tools - 登録済みとみなすツール
 * @returns 名前から引く関数（`getTool` の代わり）
 */
function registry(...tools: Tool[]) {
  const map = new Map(tools.map((tool) => [tool.definition.name, tool]));
  return (name: string) => map.get(name);
}

/** 組み込みのツール（日時・計算・Web）と登録したドキュメントの検索 */
const DEFAULT_TOOLS = registry(
  fakeTool('get_current_datetime'),
  fakeTool('calculate'),
  fakeTool('web_search'),
  fakeTool('url_fetch'),
  fakeTool('search_documents', { subAgentOnly: true })
);

const researcher = SUB_AGENTS.find((agent) => agent.name === 'researcher')!;
const reader = SUB_AGENTS.find((agent) => agent.name === 'reader')!;

/** 成功した実行の結果 */
const RUN: SubAgentResult = {
  answer: '回答',
  toolCalls: [
    {
      name: 'web_search',
      arguments: { query: 'q' },
      result: '一覧',
      isError: false,
      durationMs: 5,
    },
  ],
  rounds: 2,
};

describe('サブエージェントの定義と判定', () => {
  describe('正常系', () => {
    it('既定のツールなら、リサーチャーと手元の読み手（ドキュメントの検索）を使える', () => {
      expect(availableSubAgents(DEFAULT_TOOLS).map((a) => a.name)).toEqual([
        'researcher',
        'reader',
      ]);
    });

    it('サブエージェントへは、登録されている自分のツールだけを定義の順で渡す', () => {
      expect(subAgentToolNames(researcher, DEFAULT_TOOLS)).toEqual([
        'web_search',
        'url_fetch',
        'get_current_datetime',
        'calculate',
      ]);
      expect(subAgentToolNames(reader, DEFAULT_TOOLS)).toEqual([
        'search_documents',
        'get_current_datetime',
        'calculate',
      ]);
    });

    it('ファイル・GitHub のツールが登録されていれば、手元の読み手に渡す', () => {
      const lookup = registry(
        fakeTool('search_documents'),
        fakeTool('read_file'),
        fakeTool('github_view')
      );
      expect(subAgentToolNames(reader, lookup)).toEqual([
        'search_documents',
        'read_file',
        'github_view',
      ]);
    });

    it('委譲の引数は、相手と前後の空白を除いた仕事にする', () => {
      expect(
        parseDelegateArgs({ agent: 'reader', task: '  探して  ' }, [
          researcher,
          reader,
        ])
      ).toEqual({ ok: true, agent: reader, task: '探して' });
    });

    it('回答は長さの上限までならそのまま返し、記録・トークン数を付ける', () => {
      const metrics = {
        model: 'm',
        calls: 1,
        promptTokens: 1,
        promptCachedTokens: 0,
        maxPromptTokens: 1,
        promptDurationMs: 1,
        outputTokens: 2,
        outputDurationMs: 1,
        loadDurationMs: 0,
        totalDurationMs: 2,
      };
      expect(delegationOutput(researcher, '仕事', { ...RUN, metrics })).toEqual(
        {
          result: '回答',
          isError: false,
          summary: 'ツール 1 回',
          subAgent: {
            agent: 'researcher',
            task: '仕事',
            toolCalls: RUN.toolCalls,
            rounds: 2,
            metrics,
          },
          metrics,
        }
      );
    });

    it('委譲のツールの説明に、使える相手を並べる', () => {
      const description = delegateDescription([researcher]);
      expect(description).toContain(`researcher: ${researcher.description}`);
      expect(description).not.toContain('reader:');
    });

    it('委譲のツールの見出しは、任せた相手の名前にする', () => {
      expect(
        toolCallLabel('delegate_to_agent', { agent: 'researcher', task: 'x' })
      ).toBe('サブエージェント: Web の調べもの');
      expect(toolCallLabel('delegate_to_agent', { agent: 'reader' })).toBe(
        'サブエージェント: 手元の読みもの'
      );
      expect(toolCallLabel('web_search', { query: 'x' })).toBe('Web 検索');
    });

    it('保存した委譲の記録を読み直すと、任せた相手・仕事・中の手順・トークン数を戻す', () => {
      const metrics = {
        model: 'm',
        calls: 2,
        promptTokens: 10,
        promptCachedTokens: 0,
        maxPromptTokens: 6,
        promptDurationMs: 5,
        outputTokens: 4,
        outputDurationMs: 3,
        loadDurationMs: 0,
        totalDurationMs: 8,
      };
      const subAgent = {
        agent: 'researcher',
        task: '仕事',
        toolCalls: RUN.toolCalls,
        rounds: 2,
        metrics,
      };
      const metadata = parseMessageMetadata({
        toolCalls: [
          {
            name: 'delegate_to_agent',
            arguments: { agent: 'researcher', task: '仕事' },
            result: '回答',
            isError: false,
            durationMs: 9,
            subAgent,
          },
        ],
      });
      expect(metadata?.toolCalls?.[0].subAgent).toEqual(subAgent);
    });

    it('委譲の実行中の文・所要時間は、任せた相手の名前と秒で出す（ほかのツールはミリ秒のまま）', () => {
      expect(isDelegation('delegate_to_agent')).toBe(true);
      expect(isDelegation('web_search')).toBe(false);
      expect(delegationRunningLabel({ agent: 'researcher' })).toBe(
        'サブエージェントが Web を調べています'
      );
      expect(formatToolDuration('delegate_to_agent', 275_400)).toBe('275 秒');
      expect(formatToolDuration('web_search', 1200)).toBe('1200ms');
    });

    it('中の手順の対象は、対象を表す引数から 1 行で表す', () => {
      expect(describeToolArguments({ max_results: 5, query: 'Next.js' })).toBe(
        'Next.js'
      );
      expect(describeToolArguments({ url: 'https://example.com/' })).toBe(
        'https://example.com/'
      );
      expect(describeToolArguments({ repo: 'o/r', number: 3 })).toBe('o/r');
    });
  });

  describe('準正常系', () => {
    it('ファイル・GitHub・ドキュメントの検索が無ければ、手元の読み手は使えない（日時・計算だけでは任せない）', () => {
      const lookup = registry(
        fakeTool('get_current_datetime'),
        fakeTool('calculate'),
        fakeTool('web_search')
      );
      expect(availableSubAgents(lookup).map((a) => a.name)).toEqual([
        'researcher',
      ]);
    });

    it('承認が要るツール・画像のツール・委譲のツールは、定義にあってもサブエージェントへ渡さない', () => {
      const definition = {
        ...reader,
        toolNames: [
          'read_file',
          'write_file',
          'browser_screenshot',
          'delegate_to_agent',
        ],
      };
      const lookup = registry(
        fakeTool('read_file'),
        fakeTool('write_file', {
          prepare: async () => ({
            ok: false,
            output: { result: '', isError: true },
          }),
        }),
        fakeTool('browser_screenshot', { requiresVision: true }),
        fakeTool('delegate_to_agent')
      );
      expect(subAgentToolNames(definition, lookup)).toEqual(['read_file']);
    });

    it('上限を超える回答は切り、切ったことを末尾に書く', () => {
      const long = 'あ'.repeat(MAX_SUB_AGENT_ANSWER_CHARS + 10);
      const output = delegationOutput(researcher, '仕事', {
        ...RUN,
        answer: long,
      });
      expect(output.isError).toBe(false);
      expect(
        output.result.startsWith('あ'.repeat(MAX_SUB_AGENT_ANSWER_CHARS))
      ).toBe(true);
      expect(output.result).toContain('字で切りました');
    });

    it('上限に達してまとめた回答は、成功のまま要約に理由を書く', () => {
      expect(
        delegationOutput(researcher, '仕事', { ...RUN, limit: 'time' }).summary
      ).toBe('ツール 1 回（時間の上限でまとめた）');
      expect(
        delegationOutput(researcher, '仕事', { ...RUN, limit: 'rounds' })
      ).toMatchObject({
        isError: false,
        summary: 'ツール 1 回（問い合わせの上限でまとめた）',
      });
    });

    it('絵文字を途中で切らない（コードポイントで数える）', () => {
      const answer = '😀'.repeat(MAX_SUB_AGENT_ANSWER_CHARS + 1);
      const { text, truncated } = truncateAnswer(answer);
      expect(truncated).toBe(true);
      expect(Array.from(text)).toHaveLength(MAX_SUB_AGENT_ANSWER_CHARS);
      expect(text.endsWith('😀')).toBe(true);
    });

    it('中のツールが失敗しても、回答があれば成功にする（「見つからなかった」も回答）', () => {
      const output = delegationOutput(reader, '探して', {
        answer: '見つかりませんでした',
        toolCalls: [{ ...RUN.toolCalls[0], isError: true }],
        rounds: 2,
      });
      expect(output).toMatchObject({
        isError: false,
        result: '見つかりませんでした',
      });
    });

    it('見出しの名前・引数の要約は、知らない相手・空の引数でも崩れない', () => {
      expect(toolCallLabel('delegate_to_agent', { agent: 'translator' })).toBe(
        'サブエージェントに任せる'
      );
      expect(toolCallLabel('unknown_tool', {})).toBe('unknown_tool');
      expect(describeToolArguments({})).toBe('');
      expect(describeToolArguments({ query: '   ', flag: true })).toBe('');
      expect(describeToolArguments({ query: 'あ'.repeat(100) })).toBe(
        `${'あ'.repeat(80)}…`
      );
      expect(delegationRunningLabel({ agent: 'translator' })).toBe(
        'サブエージェントが動いています'
      );
      expect(formatToolDuration('delegate_to_agent', 0)).toBeNull();
      expect(formatToolDuration('web_search', 0)).toBeNull();
      expect(isSubAgentName('reader')).toBe(true);
      expect(isSubAgentName('translator')).toBe(false);
    });

    it('形の合わない委譲の記録は捨て、中の手順は 1 件ずつ検証する（入れ子の記録は読まない）', () => {
      const call = (subAgent: unknown) => ({
        name: 'delegate_to_agent',
        result: '回答',
        subAgent,
      });
      const metadata = parseMessageMetadata({
        toolCalls: [
          call({ agent: 'translator', task: 'x', toolCalls: [] }),
          call({ agent: 'reader', task: 1, toolCalls: [] }),
          call({ agent: 'reader', task: 'x', toolCalls: 'no' }),
          call({
            agent: 'reader',
            task: '探して',
            rounds: -1,
            metrics: { outputTokens: 'x' },
            toolCalls: [
              { name: 'read_file', result: '本文' },
              { name: 1, result: '壊れた' },
              {
                name: 'delegate_to_agent',
                result: '入れ子',
                subAgent: { agent: 'reader', task: 'y', toolCalls: [] },
              },
            ],
          }),
        ],
      });
      const runs = metadata?.toolCalls?.map((tc) => tc.subAgent);
      expect(runs?.slice(0, 3)).toEqual([undefined, undefined, undefined]);
      expect(runs?.[3]).toEqual({
        agent: 'reader',
        task: '探して',
        rounds: 0,
        toolCalls: [
          {
            name: 'read_file',
            result: '本文',
            arguments: {},
            isError: false,
            durationMs: 0,
          },
          {
            name: 'delegate_to_agent',
            result: '入れ子',
            arguments: {},
            isError: false,
            durationMs: 0,
          },
        ],
      });
    });

    it('順番待ちの判定: 同じ組に終わっていない処理があれば待つ・組が無ければ待たない（#26 Phase B）', async () => {
      const inOrder = createInOrderQueue();
      let release!: () => void;
      const first = inOrder(
        'sub-agent',
        () => new Promise<void>((resolve) => (release = resolve))
      );
      expect(inOrder.isBusy('sub-agent')).toBe(true);
      expect(inOrder.isBusy('browser')).toBe(false);
      expect(inOrder.isBusy(undefined)).toBe(false);
      // 処理は次のマイクロタスクで始まる（前の処理の終わりにつなぐため）。始まってから終わらせる
      await vi.waitFor(() => expect(release).toBeTypeOf('function'));
      release();
      await first;
      expect(inOrder.isBusy('sub-agent')).toBe(false);
      // 失敗した処理も終わったものとして数える
      await inOrder('sub-agent', () => Promise.reject(new Error('x'))).catch(
        () => {}
      );
      expect(inOrder.isBusy('sub-agent')).toBe(false);
    });

    it('渡していないツールを呼ばれたら、理由を返して実行しない', () => {
      expect(notOfferedToolOutput('search_documents')).toEqual({
        result:
          'エラー: search_documents はこの応答では使えません。渡したツールだけを使ってください。',
        isError: true,
        summary: 'search_documents はこの応答では使えません',
      });
    });
  });

  describe('異常系', () => {
    it.each([
      [
        { agent: 'translator', task: '訳して' },
        'agent は researcher・reader のどれかにしてください',
      ],
      [
        { task: '調べて' },
        'agent は researcher・reader のどれかにしてください',
      ],
      [{ agent: 'researcher' }, 'task に任せる仕事を書いてください'],
      [{ agent: 'researcher', task: 1 }, 'task に任せる仕事を書いてください'],
      [
        { agent: 'researcher', task: '  ' },
        'task に任せる仕事を書いてください',
      ],
    ])('委譲の引数 %j は失敗にする', (args, error) => {
      expect(parseDelegateArgs(args, [researcher, reader])).toEqual({
        ok: false,
        error,
      });
    });

    it('上限を超える仕事は失敗にする', () => {
      const result = parseDelegateArgs(
        { agent: 'researcher', task: 'あ'.repeat(MAX_DELEGATE_TASK_CHARS + 1) },
        [researcher]
      );
      expect(result).toMatchObject({ ok: false });
    });

    it('使えない相手（手元の読み手が無い）は、名前が正しくても失敗にする', () => {
      expect(
        parseDelegateArgs({ agent: 'reader', task: '探して' }, [researcher])
      ).toEqual({
        ok: false,
        error: 'agent は researcher のどれかにしてください',
      });
    });

    it('Ollama に問い合わせられなかった・回答が空なら、記録を付けて失敗にする', () => {
      const failed = delegationOutput(researcher, '仕事', {
        answer: '',
        toolCalls: [],
        rounds: 1,
        error: 'Ollama API error: 404',
      });
      expect(failed).toMatchObject({
        isError: true,
        summary:
          'サブエージェントが応答できませんでした（Ollama API error: 404）',
        subAgent: { agent: 'researcher', task: '仕事', rounds: 1 },
      });
      expect(
        delegationOutput(researcher, '仕事', { ...RUN, answer: '' })
      ).toMatchObject({
        isError: true,
        summary: 'サブエージェントの回答が空でした',
      });
    });
  });
});
