import type { ToolOutput } from './types';

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
