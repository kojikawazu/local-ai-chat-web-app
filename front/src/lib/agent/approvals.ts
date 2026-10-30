import type { ToolApproval } from '@/types/agent/tool-call';
import { APPROVAL_TIMEOUT_MS } from '@/constants/agent/approval';

/**
 * ツールの実行前の承認待ちを持つ（#148 Phase A2。`docs/15-tool-approval.md`）。
 *
 * エージェントループ（`/api/chat` のストリーム）が承認を待ち、承認の API（`/api/agent/approvals/[id]`）が
 * 結果を渡す。2 つの route は Next.js の開発サーバーで別にモジュールを読み込むことがあるため、
 * 承認待ちはモジュールの変数ではなく `globalThis` に置く（`lib/server/prisma.ts` と同じ置き方）。
 */

/** 承認待ち 1 件の決着のさせ方 */
type PendingApproval = (approved: boolean) => void;

// `globalThis` の型に承認待ちの Map は無いため、二段キャストで足す。
// なぜ安全か: 参照するのは自前で足す `agentApprovals` プロパティ 1 つだけで、既存のグローバル型を書き換えない。
// なぜ必要か: route ごとにモジュールが別に読み込まれても、同じプロセスの中で 1 つの Map を共有するため
const globalForApprovals = globalThis as unknown as {
  agentApprovals: Map<string, PendingApproval> | undefined;
};
const approvals: Map<string, PendingApproval> =
  globalForApprovals.agentApprovals ??
  (globalForApprovals.agentApprovals = new Map());

/** {@link waitForApproval} の指定。 */
type WaitOptions = {
  /** 承認 ID（`crypto.randomUUID()`） */
  id: string;
  /** 停止・切断で中断される signal。中断されたら待ちを取り消す */
  signal: AbortSignal;
  /** 待ち時間の上限（ミリ秒）。省略時は {@link APPROVAL_TIMEOUT_MS} */
  timeoutMs?: number;
};

/**
 * 承認待ちを登録し、決着を待つ。
 *
 * 承認の API が {@link resolveApproval} を呼ぶと決着する。待ち時間の上限に達したら `expired`。
 * `signal` が中断されたら待ちを取り消し、`rejected` として返す（書き込みはしない）。
 * どの決着でも登録は消す（決着の後の承認の API は 404 になる）。
 *
 * @param options - 承認 ID・中断の signal・待ち時間の上限
 * @returns 承認の結果
 */
export function waitForApproval({
  id,
  signal,
  timeoutMs = APPROVAL_TIMEOUT_MS,
}: WaitOptions): Promise<ToolApproval> {
  return new Promise((resolve) => {
    // timer は下で登録する。finish が呼ばれるのは登録の後（承認の API・時間切れ・中断）だけ
    const finish = (decision: ToolApproval) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      approvals.delete(id);
      resolve(decision);
    };
    const onAbort = () => finish('rejected');

    if (signal.aborted) {
      resolve('rejected');
      return;
    }
    approvals.set(id, (approved) => finish(approved ? 'approved' : 'rejected'));
    const timer = setTimeout(() => finish('expired'), timeoutMs);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * 承認待ちに結果を渡す（承認の API から呼ぶ）。
 *
 * @param id - 承認 ID
 * @param approved - 許可なら true、拒否なら false
 * @returns 待っていた承認があって決着させたら true。知らない ID・決着済みなら false
 */
export function resolveApproval(id: string, approved: boolean): boolean {
  const pending = approvals.get(id);
  if (!pending) return false;
  pending(approved);
  return true;
}
