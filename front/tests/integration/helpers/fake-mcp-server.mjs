/**
 * IT・E2E の確認用の MCP サーバー（#208）。本物の SDK で stdio に応答し、外部サービスには触れない。
 *
 * 引数の先頭をサーバーの名前にし、結果に含める（どのサーバーが答えたかを確かめるため）。
 * - `read_note`: 読むツール（`readOnlyHint: true`）。受け取った値を返す
 * - `write_note`: 注釈の無いツール（書き込みとして扱われる）
 * - `show_env`: 読むツール。環境変数の名前を返す（アプリの環境変数が渡らないことを確かめる）
 * - `show_pid`: 読むツール。プロセスの ID を返す（接続を使い回すことを確かめる）
 * - `crash`: 読むツール。プロセスを止める（接続が切れたときの動きを確かめる）
 * - `add_tool`: 読むツール。ツールを 1 つ足す（`notifications/tools/list_changed` を確かめる）
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const name = process.argv[2] ?? 'fake';
const server = new McpServer({ name, version: '1.0.0' });
const text = (value) => ({ content: [{ type: 'text', text: value }] });
const readOnly = { annotations: { readOnlyHint: true } };

server.registerTool(
  'read_note',
  {
    description: 'メモを読む',
    inputSchema: {
      id: z.string(),
      options: z.object({ limit: z.number() }).optional(),
    },
    ...readOnly,
  },
  async ({ id }) => text(`${name} のメモ ${id}: 合言葉はオーロラ`)
);
server.registerTool(
  'write_note',
  { description: 'メモを書く', inputSchema: { body: z.string() } },
  async ({ body }) => text(`${name} に書きました: ${body}`)
);
server.registerTool(
  'show_env',
  { description: '環境変数の名前を返す', inputSchema: {}, ...readOnly },
  async () => text(Object.keys(process.env).sort().join(','))
);
server.registerTool(
  'show_pid',
  { description: 'プロセスの ID を返す', inputSchema: {}, ...readOnly },
  async () => text(String(process.pid))
);
server.registerTool(
  'crash',
  { description: 'サーバーを止める', inputSchema: {}, ...readOnly },
  async () => process.exit(1)
);
server.registerTool(
  'add_tool',
  { description: 'ツールを足す', inputSchema: {}, ...readOnly },
  async () => {
    server.registerTool(
      'added_tool',
      { description: '足したツール', inputSchema: {}, ...readOnly },
      async () => text('足したツールです')
    );
    return text('足しました');
  }
);

await server.connect(new StdioServerTransport());
