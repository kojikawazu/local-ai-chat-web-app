import { describe, it, expect } from 'vitest';
import { shouldBlockTool } from '@/lib/agent/agent';
import { parseMcpConfig } from '@/lib/agent/tools/mcp/config';
import {
  buildMcpToolName,
  readSourceLabels,
  selectMcpTools,
} from '@/lib/agent/tools/mcp/naming';
import { convertMcpResult } from '@/lib/agent/tools/mcp/result';
import { createMcpTool } from '@/lib/agent/tools/mcp/tool';
import { toolCallLabel } from '@/lib/chat/tool-label';
import type { McpServerConfig } from '@/types/agent/mcp';

/** テストの承認の準備（持っていることだけを見る） */
const prepare = async () => ({
  ok: false as const,
  output: { result: '', isError: true },
});

/** サーバーの設定の最小の形 */
const SERVER: McpServerConfig = {
  name: 'jira',
  command: 'jira-mcp',
  args: [],
  env: {},
  alwaysApprove: [],
};

describe('parseMcpConfig', () => {
  describe('正常系', () => {
    it('サーバーの設定を読み、省略できる項目を補う', () => {
      const config = parseMcpConfig(
        { mcpServers: { jira: { command: '/bin/jira', args: ['-v'] } } },
        {}
      );
      expect(config.invalid).toEqual([]);
      expect(config.servers).toEqual([
        {
          name: 'jira',
          command: '/bin/jira',
          args: ['-v'],
          env: {},
          alwaysApprove: [],
        },
      ]);
    });

    it('env の ${NAME} をアプリの環境変数で置き換える', () => {
      const config = parseMcpConfig(
        {
          mcpServers: {
            jira: {
              command: 'x',
              env: { TOKEN: '${JIRA_TOKEN}', URL: 'https://${HOST}/api' },
            },
          },
        },
        { JIRA_TOKEN: 'secret', HOST: 'example.com' }
      );
      expect(config.servers[0].env).toEqual({
        TOKEN: 'secret',
        URL: 'https://example.com/api',
      });
    });

    it('tools・alwaysApprove・cwd をそのまま持つ', () => {
      const config = parseMcpConfig(
        {
          mcpServers: {
            jira: {
              command: 'x',
              cwd: '/tmp',
              tools: ['a'],
              alwaysApprove: ['a'],
            },
          },
        },
        {}
      );
      expect(config.servers[0]).toMatchObject({
        cwd: '/tmp',
        tools: ['a'],
        alwaysApprove: ['a'],
      });
    });

    it('上の階層のほかの項目は無視する', () => {
      const config = parseMcpConfig(
        { other: true, mcpServers: { jira: { command: 'x' } } },
        {}
      );
      expect(config.configError).toBeUndefined();
      expect(config.servers).toHaveLength(1);
    });
  });

  describe('準正常系', () => {
    it('誤りのあるサーバーだけを外し、ほかは使う', () => {
      const config = parseMcpConfig(
        { mcpServers: { good: { command: 'x' }, bad: { args: [] } } },
        {}
      );
      expect(config.servers.map((server) => server.name)).toEqual(['good']);
      expect(config.invalid).toEqual([
        { name: 'bad', error: 'command がありません' },
      ]);
    });

    it('環境変数が無ければ、そのサーバーを外す', () => {
      const config = parseMcpConfig(
        { mcpServers: { jira: { command: 'x', env: { A: '${MISSING}' } } } },
        {}
      );
      expect(config.invalid[0].error).toContain('MISSING');
    });

    it('知らない項目（Phase C の url 等）を黙って無視しない', () => {
      const config = parseMcpConfig(
        { mcpServers: { jira: { url: 'https://example.com' } } },
        {}
      );
      expect(config.servers).toEqual([]);
      expect(config.invalid[0].error).toContain('url');
    });

    it.each([['Jira'], ['a b'], ['a__b'], ['x'.repeat(33)]])(
      '使えない名前（%s）を外す',
      (name) => {
        const config = parseMcpConfig(
          { mcpServers: { [name]: { command: 'x' } } },
          {}
        );
        expect(config.invalid).toHaveLength(1);
      }
    );

    it('11 個目からのサーバーを外す', () => {
      const mcpServers = Object.fromEntries(
        Array.from({ length: 11 }, (_, i) => [`s${i}`, { command: 'x' }])
      );
      const config = parseMcpConfig({ mcpServers }, {});
      expect(config.servers).toHaveLength(10);
      expect(config.invalid.map((item) => item.name)).toEqual(['s10']);
    });
  });

  describe('異常系', () => {
    it.each([[null], [[]], [{}], [{ mcpServers: [] }]])(
      '形の違う設定（%j）は全体の誤りにする',
      (raw) => {
        expect(parseMcpConfig(raw, {}).configError).toBeDefined();
      }
    );

    it.each([
      [{ command: '' }, 'command'],
      [{ command: 'x', args: 'a' }, 'args'],
      [{ command: 'x', env: [] }, 'env'],
      [{ command: 'x', env: { A: 1 } }, 'env'],
      [{ command: 'x', cwd: 'relative' }, 'cwd'],
      [{ command: 'x', tools: 'a' }, 'tools'],
      [{ command: 'x', alwaysApprove: 'a' }, 'alwaysApprove'],
    ])('型の違う項目（%j）を外す', (value, key) => {
      const config = parseMcpConfig({ mcpServers: { jira: value } }, {});
      expect(config.invalid[0].error).toContain(key);
    });
  });
});

describe('ツールの名前', () => {
  describe('正常系', () => {
    it('サーバーとツールを区切って組み立てる', () => {
      expect(buildMcpToolName('jira', 'search_issues')).toBe(
        'mcp__jira__search_issues'
      );
    });

    it('見出しは「サーバー: ツール」にする', () => {
      expect(toolCallLabel('mcp__jira__search_issues', {})).toBe(
        'jira: search_issues'
      );
    });

    it('ツールの名前の中の __ は見出しで切らない', () => {
      expect(toolCallLabel('mcp__jira__a__b', {})).toBe('jira: a__b');
    });
  });

  describe('準正常系', () => {
    it('使えない文字を _ にする', () => {
      expect(buildMcpToolName('s', 'a.b/c')).toBe('mcp__s__a_b_c');
    });

    it('64 文字で切る', () => {
      expect(buildMcpToolName('s', 'x'.repeat(100))).toHaveLength(64);
    });
  });

  describe('異常系', () => {
    it('形の違う名前はそのまま出す', () => {
      expect(toolCallLabel('mcp__broken', {})).toBe('mcp__broken');
      expect(toolCallLabel('unknown_tool', {})).toBe('unknown_tool');
    });
  });
});

describe('selectMcpTools', () => {
  const tools = (...names: string[]) => names.map((name) => ({ name }));

  describe('正常系', () => {
    it('設定の順・サーバーが返した順に選ぶ', () => {
      const { selected, omitted } = selectMcpTools(
        [
          { server: 'a', tools: tools('x', 'y') },
          { server: 'b', tools: tools('z') },
        ],
        40
      );
      expect(selected.map((item) => item.name)).toEqual([
        'mcp__a__x',
        'mcp__a__y',
        'mcp__b__z',
      ]);
      expect(omitted.size).toBe(0);
    });

    it('設定の tools に無いものは候補から外し、数えない', () => {
      const { selected, omitted } = selectMcpTools(
        [{ server: 'a', tools: tools('x', 'y'), allow: ['y'] }],
        40
      );
      expect(selected.map((item) => item.tool.name)).toEqual(['y']);
      expect(omitted.size).toBe(0);
    });
  });

  describe('準正常系', () => {
    it('上限を超えた分はサーバーごとに数える', () => {
      const { selected, omitted } = selectMcpTools(
        [
          { server: 'a', tools: tools('x', 'y') },
          { server: 'b', tools: tools('z') },
        ],
        1
      );
      expect(selected).toHaveLength(1);
      expect(omitted.get('a')).toBe(1);
      expect(omitted.get('b')).toBe(1);
    });

    it('置き換えで名前がぶつかったら後のものを渡さない', () => {
      const { selected, omitted } = selectMcpTools(
        [{ server: 'a', tools: tools('x.y', 'x/y') }],
        40
      );
      expect(selected.map((item) => item.tool.name)).toEqual(['x.y']);
      expect(omitted.get('a')).toBe(1);
    });
  });

  describe('異常系', () => {
    it('ツールが無ければ空を返す', () => {
      expect(selectMcpTools([], 40).selected).toEqual([]);
    });
  });
});

describe('convertMcpResult', () => {
  describe('正常系', () => {
    it('text をつなぐ', () => {
      expect(
        convertMcpResult({
          content: [
            { type: 'text', text: 'a' },
            { type: 'text', text: 'b' },
          ],
        })
      ).toEqual({ result: 'a\nb', isError: false });
    });

    it('画像は省いたことを文章で伝える', () => {
      expect(
        convertMcpResult({
          content: [{ type: 'image', data: 'aGk=', mimeType: 'image/png' }],
        }).result
      ).toBe('（画像を省きました）');
    });

    it('content が空なら structuredContent を JSON にする', () => {
      expect(
        convertMcpResult({ content: [], structuredContent: { a: 1 } }).result
      ).toBe('{"a":1}');
    });
  });

  describe('準正常系', () => {
    it('空の結果は空と分かるようにする', () => {
      expect(convertMcpResult({ content: [] })).toMatchObject({
        isError: false,
        isEmpty: true,
      });
    });

    it('12,000 文字で切る', () => {
      const { result } = convertMcpResult({
        content: [{ type: 'text', text: 'x'.repeat(13_000) }],
      });
      expect(result.startsWith('x'.repeat(12_000))).toBe(true);
      expect(result).toContain('切りました');
      expect(result.length).toBeLessThan(12_100);
    });

    it('知らない種類は省いたことを伝える', () => {
      expect(
        convertMcpResult({ content: [{ type: 'hologram' }] }).result
      ).toContain('hologram');
    });
  });

  describe('異常系', () => {
    it('isError は失敗にする', () => {
      expect(
        convertMcpResult({
          isError: true,
          content: [{ type: 'text', text: 'boom' }],
        })
      ).toMatchObject({ isError: true, result: 'エラー: boom' });
    });

    it('理由の無い失敗にも文章を付ける', () => {
      expect(convertMcpResult({ isError: true }).result).toContain('失敗');
    });

    it.each([[null], ['x'], [{ content: 'x' }], [{ content: [null, 1] }]])(
      '形の違う結果（%j）で例外にしない',
      (raw) => {
        expect(convertMcpResult(raw).isEmpty).toBe(true);
      }
    );
  });
});

describe('持ち出しの判定（shouldBlockTool）', () => {
  const jira = { origin: 'mcp:jira' };
  const slack = { origin: 'mcp:slack' };
  const slackWrite = { origin: 'mcp:slack', prepare };

  describe('正常系', () => {
    it('何も読んでいなければ止めない', () => {
      expect(shouldBlockTool('network', new Set(), jira)).toBe(false);
    });

    it('同じサーバーの続きの操作は止めない', () => {
      expect(shouldBlockTool('network', new Set(['mcp:jira']), jira)).toBe(
        false
      );
    });

    it('別のサーバーの承認が要るツールは止めない', () => {
      expect(
        shouldBlockTool('network', new Set(['mcp:jira']), slackWrite)
      ).toBe(false);
    });

    it('手元の情報を読んだ後でも、承認が要るツールは止めない', () => {
      expect(shouldBlockTool('network', new Set(['local']), slackWrite)).toBe(
        false
      );
    });

    it('MCP を読んだ後でも、手元を読むツールは止めない', () => {
      expect(shouldBlockTool('local', new Set(['mcp:jira']))).toBe(false);
    });
  });

  describe('準正常系', () => {
    it('別のサーバーの承認の要らないツールは止める', () => {
      expect(shouldBlockTool('network', new Set(['mcp:jira']), slack)).toBe(
        true
      );
    });

    it('MCP を読んだ後の web_search・url_fetch は止める', () => {
      expect(shouldBlockTool('network', new Set(['mcp:jira']), {})).toBe(true);
    });

    it('手元の情報を読んだ後の MCP の読むツールは止める', () => {
      expect(shouldBlockTool('network', new Set(['local']), jira)).toBe(true);
    });

    it('自分と手元の両方を読んだ後は止める', () => {
      expect(
        shouldBlockTool('network', new Set(['mcp:jira', 'local']), jira)
      ).toBe(true);
    });
  });

  describe('異常系', () => {
    it('ツールが分からなくても network なら止める', () => {
      expect(shouldBlockTool('network', new Set(['local']))).toBe(true);
    });
  });
});

describe('readSourceLabels', () => {
  describe('正常系', () => {
    it('手元の情報とサーバーの名前にする', () => {
      expect(readSourceLabels(['local', 'mcp:slack'], 'mcp:jira')).toEqual([
        '手元の情報',
        'slack',
      ]);
    });
  });

  describe('準正常系', () => {
    it('自分の出どころは出さない', () => {
      expect(readSourceLabels(['mcp:jira'], 'mcp:jira')).toEqual([]);
    });
  });

  describe('異常系', () => {
    it('何も読んでいなければ空を返す', () => {
      expect(readSourceLabels([], 'mcp:jira')).toEqual([]);
    });
  });
});

describe('createMcpTool', () => {
  const info = {
    name: 'search',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        filter: { type: 'object', properties: { a: { type: 'string' } } },
      },
      required: ['filter'],
      $defs: { x: {} },
    },
  };

  describe('正常系', () => {
    it('スキーマの $schema だけを外し、入れ子と $defs を残す', () => {
      const { parameters } = createMcpTool(SERVER, info, 'n').definition;
      expect(parameters).not.toHaveProperty('$schema');
      expect(parameters.properties.filter.properties).toEqual({
        a: { type: 'string' },
      });
      expect(parameters.$defs).toEqual({ x: {} });
    });

    it('readOnlyHint: true のツールは承認なしで、両方の性質を持つ', () => {
      const tool = createMcpTool(
        SERVER,
        { ...info, annotations: { readOnlyHint: true } },
        'n'
      );
      expect(tool.prepare).toBeUndefined();
      expect(tool.access).toBe('network');
      expect(tool.origin).toBe('mcp:jira');
    });
  });

  describe('準正常系', () => {
    it('注釈が無いツールは承認が要る', () => {
      expect(createMcpTool(SERVER, info, 'n').prepare).toBeDefined();
    });

    it('readOnlyHint: false のツールは承認が要る', () => {
      const tool = createMcpTool(
        SERVER,
        { ...info, annotations: { readOnlyHint: false } },
        'n'
      );
      expect(tool.prepare).toBeDefined();
    });

    it('alwaysApprove のツールは読むツールでも承認が要る', () => {
      const tool = createMcpTool(
        { ...SERVER, alwaysApprove: ['search'] },
        { ...info, annotations: { readOnlyHint: true } },
        'n'
      );
      expect(tool.prepare).toBeDefined();
    });

    it('説明を 1,024 文字で切り、無ければ名前にする', () => {
      expect(
        createMcpTool(SERVER, { ...info, description: 'x'.repeat(2000) }, 'n')
          .definition.description
      ).toHaveLength(1024);
      expect(createMcpTool(SERVER, info, 'n').definition.description).toBe(
        'search'
      );
    });
  });

  describe('異常系', () => {
    it('properties・required の無いスキーマを補う', () => {
      const { parameters } = createMcpTool(
        SERVER,
        { name: 'x', inputSchema: { type: 'object' } },
        'n'
      ).definition;
      expect(parameters.properties).toEqual({});
      expect(parameters.required).toEqual([]);
    });

    it('承認が要るツールを execute で直接呼んでも実行しない', async () => {
      const result = await createMcpTool(SERVER, info, 'n').execute(
        {},
        new AbortController().signal
      );
      expect(result.isError).toBe(true);
    });
  });
});
