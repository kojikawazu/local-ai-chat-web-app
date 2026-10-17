import type { FullConfig } from '@playwright/test';
import { E2E_OLLAMA_MODEL } from './model';

/** `/api/models` の成功レスポンス。 */
type ModelsResponse = {
  /** Ollama に取得済みのモデル名 */
  models: string[];
  /** dev サーバーが既定で使うモデル名（`OLLAMA_MODEL` の解決結果） */
  defaultModel: string;
};

/**
 * `/api/models` の JSON が想定の形かを確かめる。
 *
 * @param data - レスポンスの JSON
 * @returns 想定の形なら `true`
 */
function isModelsResponse(data: unknown): data is ModelsResponse {
  if (typeof data !== 'object' || data === null) return false;
  // object であることは上で確認済み。各プロパティを unknown のまま取り出して下で検証するための型付け
  const { models, defaultModel } = data as Record<string, unknown>;
  return (
    Array.isArray(models) &&
    models.every((m) => typeof m === 'string') &&
    typeof defaultModel === 'string'
  );
}

/**
 * E2E の開始前に、dev サーバーが想定のモデルで動いていることを確かめる。
 *
 * Playwright は `webServer` の起動後に globalSetup を実行するため、ここでは実際に応答する
 * サーバーのモデルを検証できる。次の場合はテストを始めずに止める:
 *
 * - **別のモデルで起動済みの `pnpm dev` を再利用している**: ローカルは `reuseExistingServer` のため
 *   `webServer.env` の指定が効かず、大モデルが読み込まれてメモリを逼迫させる（#110）。
 * - **モデルを取得していない**: チャット系テストがモデル未検出で一斉に失敗し、原因が分かりにくい。
 *
 * Ollama に接続できない（`/api/models` が 502）場合は検証を省略する。Ollama を使わないテスト
 * （会話管理・レスポンシブ等）は実行でき、Ollama 依存のテストは個別に失敗として現れるため。
 *
 * @param config - Playwright の設定（`baseURL` の取得に使う）
 * @throws {Error} サーバーのモデルが想定と異なる、またはモデルが未取得の場合
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:3000';
  const res = await fetch(new URL('/api/models', baseURL));
  if (!res.ok) {
    console.warn(
      `[e2e] /api/models が ${res.status} を返したため、モデルの検証を省略します（Ollama が起動しているか確認してください）`
    );
    return;
  }

  const data: unknown = await res.json();
  if (!isModelsResponse(data)) {
    throw new Error('[e2e] /api/models のレスポンスが想定の形ではありません');
  }

  if (data.defaultModel !== E2E_OLLAMA_MODEL) {
    throw new Error(
      [
        `[e2e] dev サーバーのモデルが ${data.defaultModel} です（E2E は ${E2E_OLLAMA_MODEL} を想定）。`,
        '既に起動している pnpm dev が再利用されています。停止してから再実行するか、',
        `そのモデルで回す場合は E2E_OLLAMA_MODEL=${data.defaultModel} を指定してください。`,
      ].join('\n')
    );
  }

  if (!data.models.includes(E2E_OLLAMA_MODEL)) {
    throw new Error(
      `[e2e] モデル ${E2E_OLLAMA_MODEL} が Ollama にありません。\`ollama pull ${E2E_OLLAMA_MODEL}\` を実行してください。`
    );
  }
}
