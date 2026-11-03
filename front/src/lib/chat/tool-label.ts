import { TOOL_LABELS } from '@/constants/chat/toolLabels';
import {
  DELEGATE_TOOL_NAME,
  SUB_AGENT_LABELS,
} from '@/constants/agent/sub-agent';
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
 * 委譲のツール（#26）は、任せた相手の表示名から「リサーチャーに任せる」にする。そのほかは {@link TOOL_LABELS} の
 * 日本語の名前（無ければツール名のまま）。
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
    return `${SUB_AGENT_LABELS[args.agent]}に任せる`;
  }
  return TOOL_LABELS[name] ?? name;
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
