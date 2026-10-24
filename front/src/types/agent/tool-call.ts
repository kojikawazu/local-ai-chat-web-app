/**
 * エージェントが実行した 1 回のツール呼び出しの記録。
 *
 * サーバーのエージェントループが組み立て、`done` イベントで画面へ届き、
 * そのまま DB の `metadata.toolCalls` に保存される。
 */
export type ToolCallInfo = {
  /** 呼び出されたツール名 */
  name: string;
  /** ツールに渡された引数（キー名は各ツール定義に依存） */
  arguments: Record<string, unknown>;
  /** ツール実行結果の文字列表現（モデルへ返した文章そのもの） */
  result: string;
  /** 実行がエラー終了したかどうか */
  isError: boolean;
  /**
   * 結果パネルの見出しに出す短い要約（例: `5 件`、失敗の理由）。
   * 要約を持たない古いデータ・ツールでは省略される（#150）
   */
  summary?: string;
  /** 成功したが結果が空（検索の 0 件・本文なし）なら true。✅ と区別して表示する（#150） */
  isEmpty?: boolean;
  /** ツール実行にかかった時間（ミリ秒） */
  durationMs: number;
};
