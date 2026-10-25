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

/** PlantUML サーバーに繋がるかを確かめるために描かせる、最小のソース */
const PLANTUML_PROBE_SOURCE = 'A -> B';

/**
 * dev サーバー経由で PlantUML サーバーに繋がることを確かめる（#171）。
 *
 * PlantUML の E2E は実際の PlantUML サーバーで描く。起動し忘れると、図のテストだけが
 * 「図が表示されない」形で分かりにくく落ちるため、開始前に止めて起動の手順を示す。
 *
 * @param baseURL - dev サーバーのベース URL
 * @throws {Error} `/api/diagrams/plantuml` が描けなかった（PlantUML サーバーに繋がらない等）場合
 */
async function checkPlantUml(baseURL: string): Promise<void> {
  const res = await fetch(new URL('/api/diagrams/plantuml', baseURL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: PLANTUML_PROBE_SOURCE }),
  });
  if (res.ok) return;
  const detail = await res.text().catch(() => '');
  throw new Error(
    [
      `[e2e] PlantUML の図を描けません（/api/diagrams/plantuml が ${res.status}: ${detail}）。`,
      'プロジェクトのルートで `docker compose up -d` を実行し、PlantUML サーバーを起動してください。',
    ].join('\n')
  );
}

/**
 * E2E の開始前に、dev サーバーが想定のモデルで動いていることと、PlantUML サーバーに繋がることを確かめる。
 *
 * Playwright は `webServer` の起動後に globalSetup を実行するため、ここでは実際に応答する
 * サーバーのモデルを検証できる。次の場合はテストを始めずに止める:
 *
 * - **別のモデルで起動済みの `pnpm dev` を再利用している**: ローカルは `reuseExistingServer` のため
 *   `webServer.env` の指定が効かず、大モデルが読み込まれてメモリを逼迫させる（#110）。
 * - **モデルを取得していない**: チャット系テストがモデル未検出で一斉に失敗し、原因が分かりにくい。
 * - **PlantUML サーバーに繋がらない**: {@link checkPlantUml} を参照。
 *
 * Ollama に接続できない（`/api/models` が 502）場合は検証を省略する。Ollama を使わないテスト
 * （会話管理・レスポンシブ等）は実行でき、Ollama 依存のテストは個別に失敗として現れるため。
 *
 * @param config - Playwright の設定（`baseURL` の取得に使う）
 * @throws {Error} サーバーのモデルが想定と異なる、モデルが未取得、または PlantUML サーバーに繋がらない場合
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:3000';
  // Ollama の検証は 502 のとき途中で省略するため、PlantUML を先に確かめる
  await checkPlantUml(baseURL);
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
