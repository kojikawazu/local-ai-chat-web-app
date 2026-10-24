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
