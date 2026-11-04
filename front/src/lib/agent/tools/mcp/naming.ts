import {
  LOCAL_READ_ORIGIN,
  MCP_ORIGIN_PREFIX,
  MCP_TOOL_PREFIX,
  MCP_TOOL_SEPARATOR,
} from '@/constants/agent/mcp';

/** ツールの名前の長さの上限。OpenAI 互換の function calling の制限に合わせ、モデルへ渡せる長さにする */
const MAX_TOOL_NAME_LENGTH = 64;

/** 手元の情報を読んだことの表示 */
const LOCAL_READ_LABEL = '手元の情報';

/**
 * MCP のツールの、モデルへ渡す名前を作る（#208）。
 *
 * @param server - サーバーの名前
 * @param tool - サーバーのツールの名前
 * @returns `mcp__<サーバー>__<ツール>`。使えない文字は `_` にし、64 文字で切る
 */
export function buildMcpToolName(server: string, tool: string): string {
  const safe = tool.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${MCP_TOOL_PREFIX}${server}${MCP_TOOL_SEPARATOR}${safe}`.slice(
    0,
    MAX_TOOL_NAME_LENGTH
  );
}

/** {@link selectMcpTools} に渡す、サーバーごとのツール。 */
type McpToolCandidates<T extends { name: string }> = {
  /** サーバーの名前 */
  server: string;
  /** サーバーが返したツール */
  tools: readonly T[];
  /** 設定の `tools`。省略すると全部 */
  allow?: readonly string[];
};

/**
 * モデルへ渡すツールを選ぶ（#208）。
 *
 * 設定の `tools` に無いものは候補から外す（数えない）。名前がぶつかったもの・上限を超えたものは渡さず、サーバーごとに数える。
 * 上限はサーバーの順・サーバーが返した順で前から埋める。
 *
 * @param candidates - サーバーごとのツール（設定の順）
 * @param maxTools - 全サーバーの合計の上限
 * @returns 渡すツール（`name` はモデルへ渡す名前）と、サーバーごとの渡していない数
 */
export function selectMcpTools<T extends { name: string }>(
  candidates: readonly McpToolCandidates<T>[],
  maxTools: number
): {
  selected: { server: string; name: string; tool: T }[];
  omitted: Map<string, number>;
} {
  const selected: { server: string; name: string; tool: T }[] = [];
  const omitted = new Map<string, number>();
  const used = new Set<string>();
  for (const { server, tools, allow } of candidates) {
    for (const tool of tools) {
      if (allow && !allow.includes(tool.name)) continue;
      const name = buildMcpToolName(server, tool.name);
      if (used.has(name) || selected.length >= maxTools) {
        omitted.set(server, (omitted.get(server) ?? 0) + 1);
        continue;
      }
      used.add(name);
      selected.push({ server, name, tool });
    }
  }
  return { selected, omitted };
}

/**
 * この応答で読んだものの表示を作る（#208。承認カードの「この応答で読んだもの」）。
 *
 * @param origins - 読んだ出どころ
 * @param ownOrigin - 実行しようとしているツールの出どころ（同じ出どころは出さない）
 * @returns 表示の配列（`手元の情報`・サーバーの名前）
 */
export function readSourceLabels(
  origins: Iterable<string>,
  ownOrigin: string
): string[] {
  return Array.from(origins)
    .filter((origin) => origin !== ownOrigin)
    .map((origin) =>
      origin === LOCAL_READ_ORIGIN
        ? LOCAL_READ_LABEL
        : origin.replace(MCP_ORIGIN_PREFIX, '')
    );
}
