import { TOOL_LABELS } from '@/constants/chat/toolLabels';
import {
  DELEGATE_TOOL_NAME,
  SUB_AGENT_LABELS,
  SUB_AGENT_RUNNING_LABELS,
} from '@/constants/agent/sub-agent';
import { MCP_TOOL_PREFIX, MCP_TOOL_SEPARATOR } from '@/constants/agent/mcp';
import type { SubAgentName } from '@/types/agent/sub-agent';
import { SUB_AGENT_NAMES } from '@/types/agent/sub-agent';

/** 引数の要約に使うときに優先して見る引数の名前（ツールの対象を表すもの） */
const SUMMARY_ARGUMENT_KEYS = [
  'query',
  'url',
  'path',
  'pattern',
  'expression',
  'repo',
];

/** 引数の要約の長さの上限（文字）。1 行に収める */
const MAX_ARGUMENT_SUMMARY_CHARS = 80;

/**
 * 値がサブエージェントの名前かを判定する（#26）。
 *
 * @param value - 調べる値（モデルが書いた `agent` 等）
 * @returns サブエージェントの名前なら true
 */
export function isSubAgentName(value: unknown): value is SubAgentName {
  return (SUB_AGENT_NAMES as readonly unknown[]).includes(value);
}

/**
 * ツールの呼び出しの見出しに出す名前を決める。
 *
 * 委譲のツール（#26）は、任せた仕事の名前から「サブエージェント: Web の調べもの」にする（サブエージェントだと分かるように）。そのほかは {@link TOOL_LABELS} の
 * 日本語の名前、MCP のツール（#208）は「サーバー: ツール」（どちらでもなければツール名のまま）。
 *
 * @param name - ツール名
 * @param args - ツールに渡された引数
 * @returns 見出しに出す名前
 */
export function toolCallLabel(
  name: string,
  args: Record<string, unknown>
): string {
  if (name === DELEGATE_TOOL_NAME && isSubAgentName(args.agent)) {
    return `サブエージェント: ${SUB_AGENT_LABELS[args.agent]}`;
  }
  return TOOL_LABELS[name] ?? mcpToolLabel(name) ?? name;
}

/**
 * MCP のツールの見出しに出す名前を決める（#208。`mcp__jira__search_issues` → `jira: search_issues`）。
 * サーバーの名前は `__` を含まないため、最初の区切りで分けられる。
 *
 * @param name - ツール名
 * @returns 見出しに出す名前。MCP のツールでなければ `undefined`
 */
function mcpToolLabel(name: string): string | undefined {
  if (!name.startsWith(MCP_TOOL_PREFIX)) return undefined;
  const rest = name.slice(MCP_TOOL_PREFIX.length);
  const index = rest.indexOf(MCP_TOOL_SEPARATOR);
  return index > 0
    ? `${rest.slice(0, index)}: ${rest.slice(index + MCP_TOOL_SEPARATOR.length)}`
    : undefined;
}

/**
 * ツールの呼び出しの対象を、引数から 1 行で表す（サブエージェントの中の手順の一覧。#26）。
 *
 * 対象を表す引数（{@link SUMMARY_ARGUMENT_KEYS} の順）があればその値、無ければ最初の文字列・数の値。
 * {@link MAX_ARGUMENT_SUMMARY_CHARS} 字を超えたら切って `…` を付ける。
 *
 * @param args - ツールに渡された引数
 * @returns 対象の 1 行。文字列・数の値が無ければ空文字
 */
export function describeToolArguments(args: Record<string, unknown>): string {
  const key =
    SUMMARY_ARGUMENT_KEYS.find((k) => isDescribable(args[k])) ??
    Object.keys(args).find((k) => isDescribable(args[k]));
  if (key === undefined) return '';
  const text = String(args[key]).replace(/\s+/g, ' ').trim();
  // 文字の数はコードポイントで数える（絵文字・サロゲートペアを途中で切らない）
  const chars = Array.from(text);
  return chars.length > MAX_ARGUMENT_SUMMARY_CHARS
    ? `${chars.slice(0, MAX_ARGUMENT_SUMMARY_CHARS).join('')}…`
    : text;
}

/**
 * 引数の要約に使える値か（空でない文字列・有限の数）。
 *
 * @param value - 引数の値
 * @returns 使えるなら true
 */
function isDescribable(value: unknown): boolean {
  return (
    (typeof value === 'string' && value.trim().length > 0) ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

/**
 * 委譲のツール（サブエージェントに任せる。#26）の呼び出しかを判定する。
 *
 * @param name - ツール名
 * @returns 委譲のツールなら true
 */
export function isDelegation(name: string): boolean {
  return name === DELEGATE_TOOL_NAME;
}

/**
 * 委譲のツールの実行中に出す文（「サブエージェントが Web を調べています」。#26）。
 *
 * @param args - 委譲のツールの引数
 * @returns 任せた仕事ごとの文。相手が分からなければ「サブエージェントが動いています」
 */
export function delegationRunningLabel(args: Record<string, unknown>): string {
  return isSubAgentName(args.agent)
    ? SUB_AGENT_RUNNING_LABELS[args.agent]
    : 'サブエージェントが動いています';
}

/**
 * ツールの所要時間を見出しに出す文字にする。
 *
 * 委譲のツール（#26）は数分かかるため秒で出す（`275 秒`）。ほかのツールは今までどおりミリ秒（`1200ms`）。
 *
 * @param name - ツール名
 * @param durationMs - 所要時間（ミリ秒）
 * @returns 見出しに出す文字。0 以下なら `null`（出さない）
 */
export function formatToolDuration(
  name: string,
  durationMs: number
): string | null {
  if (durationMs <= 0) return null;
  return isDelegation(name)
    ? `${Math.round(durationMs / 1000)} 秒`
    : `${durationMs}ms`;
}
