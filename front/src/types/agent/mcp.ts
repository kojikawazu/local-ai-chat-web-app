/** MCP のサーバーの状態（#208。`docs/31-mcp-client.md`）。 */
export const MCP_SERVER_STATES = ['connected', 'failed', 'invalid'] as const;

/**
 * MCP のサーバーの状態。
 *
 * - `connected`: 接続中
 * - `failed`: 接続に失敗した・接続が切れた
 * - `invalid`: 設定の誤り（接続しない）
 */
export type McpServerState = (typeof MCP_SERVER_STATES)[number];

/** つないだ MCP のサーバー 1 つの状態（設定の画面に出す）。 */
export type McpServerStatus = {
  /** サーバーの名前（設定のキー） */
  name: string;
  /** 状態 */
  state: McpServerState;
  /** モデルへ渡しているツールの数 */
  toolCount: number;
  /** 上限・名前のぶつかりで渡していないツールの数 */
  omittedToolCount: number;
  /** 失敗・設定の誤りの理由 */
  error?: string;
};

/** MCP の接続全体の状態（`/api/tools` の `mcp`）。 */
export type McpStatus = {
  /** 設定ファイルを読めないときの理由 */
  configError?: string;
  /** サーバーの状態。未設定なら空 */
  servers: McpServerStatus[];
};

/** 検証を通ったサーバーの設定（#208。`docs/31-mcp-client.md`「設定」）。 */
export type McpServerConfig = {
  /** サーバーの名前 */
  name: string;
  /** 起動するプログラム（シェルを介さない） */
  command: string;
  /** 引数 */
  args: string[];
  /** 足す環境変数（`${NAME}` を置き換えた後） */
  env: Record<string, string>;
  /** 作業フォルダ（絶対パス） */
  cwd?: string;
  /** 使うツールの名前。省略すると全部 */
  tools?: string[];
  /** 読むツールでも承認を求めるツールの名前 */
  alwaysApprove: string[];
};

/** 設定の検証の結果。 */
export type McpConfig = {
  /** 使えるサーバー */
  servers: McpServerConfig[];
  /** 設定に誤りがあり、使わないサーバーとその理由 */
  invalid: { name: string; error: string }[];
  /** 設定ファイル全体を読めないときの理由 */
  configError?: string;
};

/** サーバーが返したツールのうち、使う項目（#208）。 */
export type McpToolInfo = {
  /** サーバーでの名前 */
  name: string;
  /** 説明 */
  description?: string;
  /** 引数の JSON Schema */
  inputSchema: Record<string, unknown>;
  /** ツールの注釈（サーバーの申告） */
  annotations?: { readOnlyHint?: boolean };
};
