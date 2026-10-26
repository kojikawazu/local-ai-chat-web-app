import type { ToolExecution, ToolOutput } from './types';

/**
 * ツールの失敗を表す実行結果を作る。
 *
 * モデルへは従来どおり `"エラー: <理由>"` の文章を返し、見出しには理由だけを出す（#150）。
 *
 * @param reason - 失敗の理由（「エラー: 」を付けない文章）
 * @returns `isError: true` の実行結果
 */
export function toolError(reason: string): ToolOutput {
  return { result: `エラー: ${reason}`, isError: true, summary: reason };
}

/**
 * ツールの接続先ごと使えない失敗を表す実行結果を作る（#157）。
 *
 * 文章と見出しは {@link toolError} と同じ。加えて印を付け、同じ応答の中では
 * エージェントループがこのツールを再び実行しないようにする（モデルが言い換えて
 * 呼び直し続けるのを止め、止められている接続先へのアクセスも増やさない）。
 *
 * @param reason - 失敗の理由（「エラー: 」を付けない文章）
 * @returns `isError: true`・`unavailable: true` の実行結果
 */
export function toolUnavailable(reason: string): ToolExecution {
  return { ...toolError(reason), unavailable: true };
}

/**
 * 承認が要るツールが、承認を経ずに `execute` で呼ばれたときの結果を作る（#148 Phase A2）。
 *
 * 承認が要るツールは、エージェントループが `prepare` → 承認 → `run` の順に進めるため、`execute` は通らない。
 * 通るのはループの外から直接呼ばれたとき（誤った使い方）だけで、そのときも実行しない。
 *
 * @returns `isError: true` の実行結果
 */
export function toolNeedsApproval(): ToolOutput {
  return toolError(
    'このツールは利用者の承認が必要なため、ここでは実行できません'
  );
}
