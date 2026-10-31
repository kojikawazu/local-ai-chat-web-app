/**
 * 応答 1 回分のトークン数・所要時間（#31。`docs/19-token-metrics.md`「集める値」）。
 *
 * Ollama の応答の終わりのチャンクから作る。エージェントの応答はラウンド（Ollama への問い合わせ）の合計。
 * 生成の速さ（トークン/秒）は持たず、表示のときに出す（後から合計して割れるように、素の値だけを持つ）。
 */
export type ResponseMetrics = {
  /** 応答したモデル（終わりのチャンクの `model`） */
  model: string;
  /** 合計した Ollama の問い合わせの数（通常のチャットは 1、エージェントはラウンドの数） */
  calls: number;
  /** 入力のトークン数（`prompt_eval_count` の合計。キャッシュの分を含む） */
  promptTokens: number;
  /** 入力のうち、キャッシュの分（`prompt_eval_cached_count` の合計。届かなければ 0） */
  promptCachedTokens: number;
  /** 一番大きかった 1 回の入力のトークン数（文脈の大きさ） */
  maxPromptTokens: number;
  /** 入力の処理の時間（ミリ秒。`prompt_eval_duration` の合計） */
  promptDurationMs: number;
  /** 出力のトークン数（`eval_count` の合計。思考のトークンを含む） */
  outputTokens: number;
  /** 出力の生成の時間（ミリ秒。`eval_duration` の合計） */
  outputDurationMs: number;
  /** モデルの読み込みの時間（ミリ秒。`load_duration` の合計） */
  loadDurationMs: number;
  /** Ollama の中の時間（ミリ秒。`total_duration` の合計） */
  totalDurationMs: number;
};
