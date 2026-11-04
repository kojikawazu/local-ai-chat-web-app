import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/** 確認用の MCP サーバー（IT と共通）。外部サービスには触れない */
const FAKE_MCP_SERVER = path.join(
  __dirname,
  '..',
  '..',
  'integration',
  'helpers',
  'fake-mcp-server.mjs'
);

/**
 * E2E の dev サーバーに `MCP_CONFIG_PATH` として渡す設定ファイル（#208）。
 *
 * `playwright.config.ts`（dev サーバーへ渡す）と `mcp.spec.ts` が同じ値を使うため、ここを唯一の定義にする。
 * 開発者の `.env.local` の MCP のサーバーを E2E につながせない。Node のパスは環境で違うため、読み込んだ時点で書く。
 *
 * - `notes`: 接続できるサーバー。ほかの E2E のモデルへ渡すツールを増やさないよう、2 つに絞る
 * - `gone`: 起動できないサーバー
 * - `broken`: 知らない項目のある設定
 */
export const E2E_MCP_CONFIG = path.join(tmpdir(), 'nordic-chat-e2e-mcp.json');
writeFileSync(
  E2E_MCP_CONFIG,
  JSON.stringify({
    mcpServers: {
      notes: {
        command: process.execPath,
        args: [FAKE_MCP_SERVER, 'notes'],
        tools: ['read_note', 'write_note'],
      },
      gone: { command: '/no/such/program' },
      broken: { url: 'https://example.com' },
    },
  })
);
