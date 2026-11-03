import type { SubAgentName } from '@/types/agent/sub-agent';

/** 委譲のツールの名前（#26。`docs/29-multi-agent.md`「委譲のツール」） */
export const DELEGATE_TOOL_NAME = 'delegate_to_agent';

/**
 * サブエージェントの表示名（任せる仕事の名前）。委譲のツールの見出し（「サブエージェント: Web の調べもの」）に出す。
 * 役割の名前（リサーチャー）にすると、サブエージェントだと分からず、エージェントのプリセットの「リサーチャー」ともぶつかったため、仕事の名前にした
 */
export const SUB_AGENT_LABELS: Record<SubAgentName, string> = {
  researcher: 'Web の調べもの',
  reader: '手元の読みもの',
};

/** サブエージェントに任せている間に出す文（「サブエージェントが Web を調べています」） */
export const SUB_AGENT_RUNNING_LABELS: Record<SubAgentName, string> = {
  researcher: 'サブエージェントが Web を調べています',
  reader: 'サブエージェントが手元を読んでいます',
};

/**
 * サブエージェントの Ollama への問い合わせの上限（ラウンド）。任せる仕事は 1 つの調べもののため、メイン（既定 10）より小さくし、
 * 委譲 1 回の時間を抑える。超えたら、ツールを渡さずにもう 1 回問い合わせて最終回答を作らせる
 */
export const SUB_AGENT_MAX_ROUNDS = 6;

/**
 * サブエージェントがまとめ始める時間（ミリ秒、2 分半）。過ぎたら途中の問い合わせ・中のツールも止め、ツールを渡さずに最終回答を作らせる。
 * 実機で、大きいモデルが 1 ラウンドに 1 分以上かけ、新しいラウンドを始めないだけでは {@link SUB_AGENT_TIMEOUT_MS} に間に合わず、
 * 調べた分も回答も失われた。180 秒では、ページを 15 個読んで膨らんだ文脈の最終回答が残りの 120 秒に収まらなかったため、
 * 最終回答に 150 秒を残す（docs/29「実装で分かったこと」）
 */
export const SUB_AGENT_ANSWER_BY_MS = 150_000;

/**
 * サブエージェント全体の時間の上限（ミリ秒、5 分）。最終回答もここで止め、調べた分の記録と理由を返す。
 * ツールの時間の上限として受け付ける最大（`AGENT_TOOL_TIMEOUT_MS` の上限）と同じ
 */
export const SUB_AGENT_TIMEOUT_MS = 300_000;

/**
 * 委譲のツールの時間の上限（ミリ秒）。サブエージェントが自分で止める {@link SUB_AGENT_TIMEOUT_MS} より 30 秒長くし、
 * 止まらなかったときの保険にする（ここで打ち切ると記録が残らない）
 */
export const DELEGATE_TOOL_TIMEOUT_MS = SUB_AGENT_TIMEOUT_MS + 30_000;

/**
 * 1 回の応答で委譲できる回数。最悪でも 20 分ほど（{@link SUB_AGENT_TIMEOUT_MS} × 4）で止める。
 * 前提の調査では、1 回の応答の委譲は 2 つまでだった
 */
export const MAX_DELEGATIONS_PER_RESPONSE = 4;

/** 任せる仕事（`task`）の上限（文字）。調査で書かれた仕事の文は 1,000 字ほど。会話の本文を丸ごと貼らせない */
export const MAX_DELEGATE_TASK_CHARS = 4_000;

/**
 * メインへ返すサブエージェントの回答の上限（文字）。プロンプトでは 2,000 字ほどを頼む。超えた分はメインの文脈を膨らませるため切る
 */
export const MAX_SUB_AGENT_ANSWER_CHARS = 8_000;
