import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { MCP_TOOL_SEPARATOR } from '@/constants/agent/mcp';
import type { McpConfig, McpServerConfig } from '@/types/agent/mcp';

/** つなげるサーバーの上限。起動する子プロセスの数を抑える */
const MAX_SERVERS = 10;

/** サーバーの名前の形。ツールの名前の一部になるため、モデルへ渡せる文字に限る */
const SERVER_NAME_PATTERN = /^[a-z0-9_-]{1,32}$/;

/** `env` の値の中の、アプリの環境変数を入れる書き方（`${NAME}`） */
const ENV_REFERENCE_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** サーバーの設定で使える項目。知らない項目（Phase C の `url` 等）を黙って無視しないために持つ */
const KNOWN_SERVER_KEYS = new Set([
  'command',
  'args',
  'env',
  'cwd',
  'tools',
  'alwaysApprove',
]);

/**
 * 値がオブジェクト（配列・`null` を除く）かを判定する。
 *
 * @param value - 調べる値
 * @returns オブジェクトなら true
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 値が文字列の配列かを判定する。
 *
 * @param value - 調べる値
 * @returns 文字列の配列なら true
 */
function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

/**
 * `env` の値の `${NAME}` を、アプリの環境変数で置き換える。
 *
 * @param env - 設定の `env`
 * @param appEnv - アプリの環境変数
 * @returns 置き換えた環境変数か、誤りの理由
 */
function resolveEnv(
  env: Record<string, unknown>,
  appEnv: Record<string, string | undefined>
): { ok: true; env: Record<string, string> } | { ok: false; error: string } {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string') {
      return { ok: false, error: `env の ${key} が文字列ではありません` };
    }
    const missing: string[] = [];
    resolved[key] = value.replace(ENV_REFERENCE_PATTERN, (_, name: string) => {
      const found = appEnv[name];
      if (found === undefined) missing.push(name);
      return found ?? '';
    });
    if (missing.length > 0) {
      return { ok: false, error: `環境変数 ${missing[0]} がありません` };
    }
  }
  return { ok: true, env: resolved };
}

/**
 * サーバー 1 つの設定を検証する。
 *
 * @param name - サーバーの名前
 * @param raw - 設定の値
 * @param appEnv - アプリの環境変数
 * @returns 検証を通った設定か、誤りの理由
 */
function parseServer(
  name: string,
  raw: unknown,
  appEnv: Record<string, string | undefined>
): { ok: true; config: McpServerConfig } | { ok: false; error: string } {
  if (!SERVER_NAME_PATTERN.test(name) || name.includes(MCP_TOOL_SEPARATOR)) {
    return {
      ok: false,
      error:
        '名前は英小文字・数字・`-`・`_` の 32 文字までにしてください（`__` は使えません）',
    };
  }
  if (!isRecord(raw))
    return { ok: false, error: '設定がオブジェクトではありません' };
  const unknownKey = Object.keys(raw).find(
    (key) => !KNOWN_SERVER_KEYS.has(key)
  );
  if (unknownKey !== undefined) {
    return { ok: false, error: `知らない項目です: ${unknownKey}` };
  }
  const { command, args = [], env = {}, cwd, tools, alwaysApprove = [] } = raw;
  if (typeof command !== 'string' || command.trim() === '') {
    return { ok: false, error: 'command がありません' };
  }
  if (!isStringArray(args)) {
    return { ok: false, error: 'args は文字列の配列にしてください' };
  }
  if (!isRecord(env)) {
    return { ok: false, error: 'env はオブジェクトにしてください' };
  }
  if (cwd !== undefined && (typeof cwd !== 'string' || !isAbsolute(cwd))) {
    return { ok: false, error: 'cwd は絶対パスにしてください' };
  }
  if (tools !== undefined && !isStringArray(tools)) {
    return { ok: false, error: 'tools は文字列の配列にしてください' };
  }
  if (!isStringArray(alwaysApprove)) {
    return { ok: false, error: 'alwaysApprove は文字列の配列にしてください' };
  }
  const resolved = resolveEnv(env, appEnv);
  if (!resolved.ok) return resolved;
  return {
    ok: true,
    config: {
      name,
      command,
      args,
      env: resolved.env,
      ...(cwd !== undefined && { cwd }),
      ...(tools !== undefined && { tools }),
      alwaysApprove,
    },
  };
}

/**
 * 設定の JSON を検証する（#208）。誤りのあるサーバーだけを外し、ほかのサーバーは使う。
 *
 * @param raw - `JSON.parse` した設定
 * @param appEnv - `${NAME}` を置き換えるアプリの環境変数
 * @returns 検証の結果
 */
export function parseMcpConfig(
  raw: unknown,
  appEnv: Record<string, string | undefined>
): McpConfig {
  if (!isRecord(raw) || !isRecord(raw.mcpServers)) {
    return {
      servers: [],
      invalid: [],
      configError: '設定に mcpServers のオブジェクトがありません',
    };
  }
  const servers: McpServerConfig[] = [];
  const invalid: McpConfig['invalid'] = [];
  for (const [name, value] of Object.entries(raw.mcpServers)) {
    if (servers.length >= MAX_SERVERS) {
      invalid.push({ name, error: `サーバーは ${MAX_SERVERS} 個までです` });
      continue;
    }
    const parsed = parseServer(name, value, appEnv);
    if (parsed.ok) servers.push(parsed.config);
    else invalid.push({ name, error: parsed.error });
  }
  return { servers, invalid };
}

/**
 * `MCP_CONFIG_PATH` の設定を読む。
 *
 * @returns 検証の結果。未設定なら `null`
 */
export async function loadMcpConfig(): Promise<McpConfig | null> {
  const value = process.env.MCP_CONFIG_PATH?.trim();
  if (!value) return null;
  const path = value.startsWith('~/') ? join(homedir(), value.slice(2)) : value;
  const failed = (configError: string): McpConfig => ({
    servers: [],
    invalid: [],
    configError,
  });
  if (!isAbsolute(path)) {
    return failed('MCP_CONFIG_PATH は絶対パスにしてください');
  }
  try {
    const raw: unknown = JSON.parse(await readFile(path, 'utf8'));
    return parseMcpConfig(raw, process.env);
  } catch (error) {
    return failed(
      `設定ファイルを読めません: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
