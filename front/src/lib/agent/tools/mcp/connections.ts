import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  ErrorCode,
  McpError,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type {
  McpConfig,
  McpServerConfig,
  McpToolInfo,
} from '@/types/agent/mcp';
import type { ToolExecution } from '../types';
import { toolError, toolUnavailable } from '../output';
import { loadMcpConfig } from './config';
import { convertMcpResult } from './result';

/** サーバーへ名乗るクライアントの名前 */
const CLIENT_NAME = 'local-ai-chat-web-app';

/** サーバーへ名乗るクライアントの版。プロトコルの動作には関わらない */
const CLIENT_VERSION = '0.1.0';

/** 接続・一覧の取得の待ち時間（ミリ秒）。応答の始めを長く止めない */
const CONNECT_TIMEOUT_MS = 10_000;

/** 接続に失敗した後、次に接続するまで待つ時間（ミリ秒）。送るたびに 10 秒待たせない */
const RETRY_DELAY_MS = 30_000;

/**
 * SDK のツールの呼び出しの待ち時間（ミリ秒）。時間の上限はループの `signal` で掛けるため、SDK の既定の 60 秒で先に切れないよう長くする
 */
const CALL_TIMEOUT_MS = 600_000;

/** 取り込むツールの数の上限。ページを際限なく読まない */
const MAX_LISTED_TOOLS = 1_000;

/** 失敗の理由に足す標準エラーの長さ（文字）。ログには流さず、ここでだけ使う */
const MAX_STDERR_CHARS = 300;

/** サーバー 1 つの接続。 */
type McpConnection = {
  /** 設定 */
  config: McpServerConfig;
  /** 接続中のクライアント。切れていれば `undefined` */
  client?: Client;
  /** 取得したツール */
  tools: McpToolInfo[];
  /** ツールの一覧が変わったと知らされたか（次の応答で取り直す） */
  stale: boolean;
  /** 失敗の理由 */
  error?: string;
  /** これより前は接続しない（`Date.now()` の値） */
  retryAt: number;
  /** 進行中の接続・取得 */
  pending?: Promise<void>;
};

/** 接続の置き場所。 */
type McpStore = {
  /** 設定の読み込み（アプリの起動後に 1 度） */
  config?: Promise<McpConfig | null>;
  /** サーバーの名前 → 接続 */
  connections: Map<string, McpConnection>;
};

// why: route ごとにモジュールが別に読み込まれ、ホットリロードでも読み直されるため、モジュールの変数に置くと
// 接続（子プロセス）が増える。`/api/chat` と `/api/tools` で共有するため globalThis に持つ
const globalForMcp = globalThis as typeof globalThis & {
  __mcpStore?: McpStore;
};

/**
 * 接続の置き場所を返す。
 *
 * @returns 接続の置き場所
 */
function getStore(): McpStore {
  globalForMcp.__mcpStore ??= { connections: new Map() };
  return globalForMcp.__mcpStore;
}

/**
 * 例外から失敗の理由を取り出す。
 *
 * @param error - 例外
 * @returns 理由
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * ツールの一覧をページの終わりまで取る。
 *
 * @param client - 接続中のクライアント
 * @returns ツール
 */
async function listAllTools(client: Client): Promise<McpToolInfo[]> {
  const tools: McpToolInfo[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined, {
      timeout: CONNECT_TIMEOUT_MS,
    });
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor && tools.length < MAX_LISTED_TOOLS);
  return tools.slice(0, MAX_LISTED_TOOLS);
}

/**
 * サーバーを起動して接続し、ツールの一覧を取る。失敗しても例外にせず、接続に理由を残す。
 *
 * capabilities は宣言しない（`sampling`・`elicitation`・`roots` をサーバーへ渡さない）。
 * 環境変数は SDK の既定と設定の `env` だけを渡す（アプリの環境変数を渡さない）。
 *
 * @param connection - 接続
 */
async function connect(connection: McpConnection): Promise<void> {
  const { command, args, env, cwd } = connection.config;
  const transport = new StdioClientTransport({
    command,
    args,
    env,
    cwd,
    stderr: 'pipe',
  });
  let stderrTail = '';
  transport.stderr?.on('data', (chunk: unknown) => {
    stderrTail = (stderrTail + String(chunk)).slice(-MAX_STDERR_CHARS);
  });
  const client = new Client({ name: CLIENT_NAME, version: CLIENT_VERSION });
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    connection.stale = true;
  });
  client.onclose = () => {
    if (connection.client !== client) return;
    connection.client = undefined;
    connection.tools = [];
    connection.error = 'サーバーとの接続が切れました';
  };
  try {
    await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS });
    connection.tools = await listAllTools(client);
    connection.client = client;
    connection.stale = false;
    connection.error = undefined;
  } catch (error) {
    connection.client = undefined;
    connection.tools = [];
    connection.error = [messageOf(error), stderrTail.trim()]
      .filter(Boolean)
      .join(' / ');
    connection.retryAt = Date.now() + RETRY_DELAY_MS;
    await client.close().catch(() => {});
  }
}

/**
 * 変わったと知らされたツールの一覧を取り直す。失敗したら今の一覧のまま、次の応答で取り直す。
 *
 * @param connection - 接続
 * @param client - 接続中のクライアント
 */
async function reloadTools(
  connection: McpConnection,
  client: Client
): Promise<void> {
  try {
    connection.tools = await listAllTools(client);
    connection.stale = false;
  } catch (error) {
    console.error(
      `MCP のツールの一覧を取り直せません（${connection.config.name}）:`,
      error
    );
  }
}

/**
 * 接続を、使える状態にする（要らなければ何もしない）。同じサーバーへの処理は 1 つにまとめる。
 *
 * @param connection - 接続
 */
async function refresh(connection: McpConnection): Promise<void> {
  const { client } = connection;
  if (client ? !connection.stale : Date.now() < connection.retryAt) return;
  connection.pending ??= (
    client ? reloadTools(connection, client) : connect(connection)
  ).finally(() => {
    connection.pending = undefined;
  });
  await connection.pending;
}

/**
 * 設定のサーバーへ接続し、今の接続を返す（#208）。
 *
 * 失敗したサーバーは飛ばす（例外にしない）。応答ごとには接続せず、切れたものだけを接続し直す。
 *
 * @returns 設定と接続。未設定なら `null`
 */
export async function ensureMcpConnections(): Promise<{
  config: McpConfig;
  connections: McpConnection[];
} | null> {
  const store = getStore();
  store.config ??= loadMcpConfig();
  const config = await store.config;
  if (!config) return null;
  const connections = config.servers.map((server) => {
    const found = store.connections.get(server.name);
    if (found) return found;
    const created: McpConnection = {
      config: server,
      tools: [],
      stale: false,
      retryAt: 0,
    };
    store.connections.set(server.name, created);
    return created;
  });
  await Promise.all(connections.map(refresh));
  return { config, connections };
}

/**
 * サーバーのツールを実行する（#208）。
 *
 * @param server - サーバーの名前
 * @param tool - サーバーでのツールの名前
 * @param args - 引数
 * @param signal - ツールのタイムアウト・停止で中断される signal
 * @returns 実行結果。接続が切れていれば `unavailable`（同じ応答では呼び直さない）
 */
export async function callMcpTool(
  server: string,
  tool: string,
  args: Record<string, unknown>,
  signal: AbortSignal
): Promise<ToolExecution> {
  const client = getStore().connections.get(server)?.client;
  if (!client) {
    return toolUnavailable(`MCP のサーバー ${server} に接続していません`);
  }
  try {
    const result = await client.callTool(
      { name: tool, arguments: args },
      undefined,
      { signal, timeout: CALL_TIMEOUT_MS }
    );
    return convertMcpResult(result);
  } catch (error) {
    const closed =
      error instanceof McpError && error.code === ErrorCode.ConnectionClosed;
    return closed
      ? toolUnavailable(`MCP のサーバー ${server} との接続が切れました`)
      : toolError(messageOf(error));
  }
}

/**
 * MCP のサーバーへの接続があるかを返す（ツールの準備で、承認を求める前に確かめる）。
 *
 * @param server - サーバーの名前
 * @returns 接続中なら true
 */
export function isMcpConnected(server: string): boolean {
  return getStore().connections.get(server)?.client !== undefined;
}

/**
 * すべての接続を閉じて、設定も読み直す状態に戻す（テストの片付け）。
 */
export async function closeMcpConnections(): Promise<void> {
  const store = getStore();
  const clients = Array.from(store.connections.values()).flatMap(
    (connection) => (connection.client ? [connection.client] : [])
  );
  globalForMcp.__mcpStore = undefined;
  await Promise.all(clients.map((client) => client.close().catch(() => {})));
}
