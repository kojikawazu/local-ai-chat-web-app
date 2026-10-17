/**
 * E2E で使う Ollama モデルの解決。
 *
 * `playwright.config.ts`（dev サーバーへ `OLLAMA_MODEL` として渡す）・`global-setup.ts`
 * （起動中のサーバーのモデルを検証する）・各 spec（モデルの能力に依存するテストのスキップ判定）が
 * 同じ値を参照するため、ここを唯一の定義にする。
 */

/**
 * E2E の既定モデル（ローカル・CI 共通）。
 *
 * 以前のアプリ既定モデル（`qwen3-coder-next`、読み込み時約 58GB）を E2E で読み込むと、
 * 64GB の Mac でメモリが逼迫して他のアプリに影響が出たため、CI と同じ 1GB 未満の軽量モデルにする（#110）。
 * 現在の既定（`qwen3.8:27b`、約 17GB）でも E2E のたびに読み込むには重いため、軽量モデルのままとする。
 */
export const E2E_LIGHT_MODEL = 'qwen2.5:0.5b';

/**
 * E2E で dev サーバーに使わせるモデル。
 *
 * 環境変数 `E2E_OLLAMA_MODEL` で上書きできる（大モデルでツール呼び出し依存のテストまで回す場合など）。
 * アプリ用の `OLLAMA_MODEL` は `.env.local` の値（大モデル）を拾ってしまうため、E2E 専用の名前に分けている。
 */
export const E2E_OLLAMA_MODEL = process.env.E2E_OLLAMA_MODEL || E2E_LIGHT_MODEL;

/**
 * 軽量モデルで実行しているか。
 *
 * 軽量モデルはツール呼び出しを安定して行えないため、それに依存するテストのスキップ判定に使う。
 */
export const IS_LIGHT_MODEL = E2E_OLLAMA_MODEL === E2E_LIGHT_MODEL;
