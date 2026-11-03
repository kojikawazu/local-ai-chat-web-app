import { MAX_INSTRUCTIONS_PER_RESPONSE } from '@/lib/shared/validation';

/**
 * 応答の途中の指示（割り込み。#241。`docs/30-agent-interrupt.md`）の受け箱を、応答ごとに持つ。
 *
 * エージェントループ（`/api/chat` のストリーム）が応答の始めに受け箱を作り、指示の API
 * （`/api/agent/responses/[id]/instructions`）が指示を入れる。ループは次の問い合わせの前（区切り）に取り出して読む。
 * 2 つの route は Next.js の開発サーバーで別にモジュールを読み込むことがあるため、承認の待ち合わせ（`approvals.ts`）と同じく
 * `globalThis` に置く。
 */

/** 受け箱に入った指示 1 件。 */
export type PendingInstruction = {
  /** 指示の ID（API が採番して画面へ返し、読んだことを知らせる `instruction_applied` に載せる） */
  id: string;
  /** 前後の空白を除いた本文 */
  content: string;
};

/** 応答 1 つの受け箱。 */
type Inbox = {
  /** まだ読まれていない指示（届いた順） */
  items: PendingInstruction[];
  /** この応答で受け付けた指示の数（読んだ分も含む。上限の判定に使う） */
  accepted: number;
  /** 指示が届いたら呼ぶもの（サブエージェントのまとめ始め） */
  listeners: Set<() => void>;
};

// `globalThis` の型に受け箱の Map は無いため、二段キャストで足す。
// なぜ安全か: 参照するのは自前で足す `agentInstructionInboxes` プロパティ 1 つだけで、既存のグローバル型を書き換えない。
// なぜ必要か: route ごとにモジュールが別に読み込まれても、同じプロセスの中で 1 つの Map を共有するため
const globalForInstructions = globalThis as unknown as {
  agentInstructionInboxes: Map<string, Inbox> | undefined;
};
const inboxes: Map<string, Inbox> =
  globalForInstructions.agentInstructionInboxes ??
  (globalForInstructions.agentInstructionInboxes = new Map());

/**
 * 応答の受け箱を作る（応答の始めに呼ぶ）。
 *
 * @param responseId - 応答の ID（`crypto.randomUUID()`）
 */
export function registerResponse(responseId: string): void {
  inboxes.set(responseId, { items: [], accepted: 0, listeners: new Set() });
}

/**
 * 応答の受け箱を消す（応答の終わり（完了・エラー・停止）に必ず呼ぶ）。消した後の指示の API は 404 になる。
 *
 * @param responseId - 応答の ID
 */
export function unregisterResponse(responseId: string): void {
  inboxes.delete(responseId);
}

/** {@link addInstruction} の結果。 */
export type AddInstructionResult =
  { ok: true; id: string } | { ok: false; reason: 'not_found' | 'limit' };

/**
 * 受け箱に指示を入れる（指示の API から呼ぶ）。入れたら、届くのを待っているもの（サブエージェント）に知らせる。
 *
 * @param responseId - 応答の ID
 * @param content - 検証済みの本文
 * @returns 入れたら指示の ID。応答が無い（終わった・知らない）なら `not_found`、1 回の応答の上限を超えたら `limit`
 */
export function addInstruction(
  responseId: string,
  content: string
): AddInstructionResult {
  const inbox = inboxes.get(responseId);
  if (!inbox) return { ok: false, reason: 'not_found' };
  if (inbox.accepted >= MAX_INSTRUCTIONS_PER_RESPONSE) {
    return { ok: false, reason: 'limit' };
  }
  const id = crypto.randomUUID();
  inbox.items.push({ id, content });
  inbox.accepted++;
  for (const listener of inbox.listeners) listener();
  return { ok: true, id };
}

/**
 * まだ読まれていない指示を取り出して空にする（ループの区切りで呼ぶ）。
 *
 * @param responseId - 応答の ID
 * @returns 届いた順の指示。無ければ空
 */
export function takeInstructions(responseId: string): PendingInstruction[] {
  const inbox = inboxes.get(responseId);
  if (!inbox) return [];
  const { items } = inbox;
  inbox.items = [];
  return items;
}

/**
 * まだ読まれていない指示があるか。
 *
 * @param responseId - 応答の ID
 * @returns 1 件以上あれば true
 */
export function hasInstructions(responseId: string): boolean {
  return (inboxes.get(responseId)?.items.length ?? 0) > 0;
}

/**
 * 指示が届いたら呼ぶものを登録する（サブエージェントのまとめ始め）。
 *
 * @param responseId - 応答の ID
 * @param listener - 届いたら呼ぶもの
 * @returns 登録を外す関数
 */
export function onInstruction(
  responseId: string,
  listener: () => void
): () => void {
  const inbox = inboxes.get(responseId);
  if (!inbox) return () => {};
  inbox.listeners.add(listener);
  return () => inbox.listeners.delete(listener);
}
