---
description: テスト方針・構成・実行方法
globs: "front/tests/**"
---

# テスト方針

- **3層構成**: ユニット（UT / Vitest）+ インテグレーション（IT / Vitest + Testcontainers）+ E2E（Playwright）。
  - **UT**: 外部 I/O 非依存の純ロジック（バリデーション・式評価・プリセット探索等）を対象とする。
  - **IT**: route handler を**ブラウザ抜き**で直接叩き、**実 PostgreSQL（Testcontainers）**相手に handler↔Prisma↔DB の配線を検証する。**実依存（DB）は使い、mock は真の外部 3rd-party（Ollama / Web）のみ**。
  - **E2E 必須**: 実際の Ollama + PostgreSQL に接続して主要フローを検証する。
  - **UI コンポーネント単位のユニットテストは不要**（E2E で担保する）。
- **3分類必須**: UT・IT・E2E とも全テストファイルに正常系・準正常系・異常系を含める。
  - `describe('正常系')`, `describe('準正常系')`, `describe('異常系')` に分割する。
  - **要件はファイル単位**。1 ファイルに複数エンドポイント（`describe`）がある場合、各ブロックすべてに 3 分類を置く必要はない。
  - **異常系を置けない場合はコード内に理由を残す**。例: 引数を取らない GET は入力起因の失敗経路が無く、残る失敗経路（DB 接続断→500）の検証は Prisma のモックを要して IT の mock 方針に反する。この種の判断は**コメントで根拠を明記**し、単に省略しない。
  - **デバッグ用スクラッチは作らない**。調査目的の一時ファイルはテストとして残さず、得られた結論をヘルパー・本テストに反映して破棄する（3 分類の対象外にするのではなく、そもそも残さない）。
- **実環境テスト（E2E）**: 実際の Ollama + PostgreSQL に接続してテスト実行。
- **テストデータ管理**: テストスイート（ファイル）単位でセットアップ/クリーンアップ。
- **CI スキップ**: ストリーミング完了テスト・スクリーンショットテストは CI スキップ。

## CI の発火条件（paths-ignore）

**ドキュメントのみの変更では CI（`unit-test` / `integration-test` / `e2e-test` の 3 ジョブすべて）を発火させない。** コードの動作に影響しない変更で E2E（1 回 3〜5 分）を回すのは無駄なため。

`.github/workflows/*.yml` の `paths-ignore` が唯一の真実。除外対象:

| パターン | 対象 |
|---|---|
| `docs/**` | プロジェクトドキュメント |
| `manuals/**` | セットアップガイド等 |
| `**.md` | 全階層の Markdown（`README.md`・`CLAUDE.md` 含む） |
| `.claude/**` | Claude 向けルール・スキル（Markdown のみでコード実行に無関係） |
| `LICENSE` | ライセンス |

**発火させる（除外しない）もの**: `front/**`・`prisma/**`・`docker-compose.yml`・`Makefile`・`package.json` 等の実行に関わるファイル、および **`.github/workflows/**` 自体**（ワークフローの変更は動作確認が必要なため）。

### 挙動の注意

- `paths-ignore` は「**変更ファイルが全て該当した場合のみスキップ**」。コードとドキュメントが混在する PR では通常どおり実行される。
- **main に branch protection を設定し、これらを required status check に指定する場合は要注意**。スキップされたジョブは "skipped" ではなく「**報告なし**」になるため、チェックが永久に完了せず PR がマージ不能になる。その場合は `paths-ignore` を外すか、同名 job を success させる別ワークフローを用意する。現状 main は branch protection 未設定のため問題ない。

## テストツール

| テスト種別 | ツール | 配置 |
|-----------|--------|------|
| ユニットテスト（UT） | Vitest（node 環境） | `front/tests/unit/` |
| インテグレーションテスト（IT） | Vitest + Testcontainers（PostgreSQL） | `front/tests/integration/` |
| E2E テスト | Playwright（Chromium のみ） | `front/tests/e2e/` |
| スクリーンショット | Playwright（ビジュアルリグレッション） | `front/tests/e2e/` |

## UT（Vitest）方針

- **対象**: 外部 I/O 非依存の純ロジック（例: `lib/validation.ts`・`lib/tools/calculate.ts`・`lib/agent-prompts.ts`）。
- **モック方針**: 外部 I/O（fetch / DB 等）のみモック。**ビジネスロジックはモックしない**（実装追認・ハッピーパス偏重を避ける）。今回の初期対象は純関数のため mock を一切使わない。
- **実行**: `pnpm test:unit`（CI では専用 `unit-test` ジョブ。Ollama / DB 不要で数十秒で完了、E2E と独立）。
- **設定**: `front/vitest.config.ts`（`tests/unit/**` のみ対象、`@/*` エイリアス解決）。

## IT（Vitest + Testcontainers）方針

- **対象**: route handler 全般。
  - DB 依存（`/api/conversations` 系の CRUD・messages・cascade 削除・404/400）→ 実 DB で検証。
  - 外部依存（`/api/chat`・`/api/models`）→ Ollama を fetch スタブして**エラー契約**（接続失敗→502、バリデーション→400）と正常応答の中継を検証。
- **実依存**: PostgreSQL を **Testcontainers で使い捨てコンテナとして起動**し、`prisma migrate deploy` でスキーマ適用。開発 DB には一切触れない。
- **mock 方針**: 真の外部 3rd-party（Ollama / DuckDuckGo / 任意 Web）**のみ**手製 fetch スタブ（`helpers/ollama-stub.ts` の `stubFetch`）で差し替える。DB はモックしない（配線検証が目的）。

## エラーハンドリングの層分担

エラー系は「契約」と「見た目」で層を分ける（E2E で自前ロジックを mock しないため）。

- **API のエラー契約**（Ollama ダウン→502、DB/バリデーション→4xx/5xx）→ **IT**（fetch スタブで決定的に検証）。
- **エラー時の UI 描画・耐性**（エラーメッセージ表示・クラッシュしない・エラー状態のスクショ）→ **E2E**。ブラウザ必須かつ実バックエンドを安定的に壊せないため、**境界の障害注入（`page.route`）を唯一の許容例外**とする。
- **呼び出し**: handler を関数として import し、`NextRequest` を組んで直接実行（ブラウザ・Next サーバー起動なし）。
- **隔離**: 各テスト `beforeEach` で会話を全削除（Message は cascade）。`fileParallelism: false` で DB 競合を回避。
- **実行**: `pnpm test:integration`（CI では専用 `integration-test` ジョブ。Docker のみ必要、Ollama 不要）。
- **設定**: `front/vitest.integration.config.ts`・`front/tests/integration/helpers/`（global-setup でコンテナ起動、setup-env で接続 URL を注入）。
- **前提**: 生成クライアント（`src/generated/prisma/`）は gitignore のため、実行前に `pnpm prisma generate` が必要。

## Playwright 設定

- `workers: 1`（順次実行）、`retry: 1`、`webServer` で `pnpm dev` を自動起動
- **モデル**: `E2E_OLLAMA_MODEL`（既定 `qwen2.5:0.5b`。ローカル・CI 共通）を `webServer.env` で dev サーバーの `OLLAMA_MODEL` として渡す。定義は `tests/e2e/helpers/model.ts` のみ。
  - 理由: アプリ既定の大モデル（読み込み時約 58GB）を E2E で読み込むと、64GB の Mac でメモリが逼迫する（#110）。
  - 大モデルで回す場合は `E2E_OLLAMA_MODEL=<model> pnpm test:e2e`。
  - **ツール呼び出しに依存するテストは `IS_LIGHT_MODEL` でスキップする**（`process.env.CI` ではなくモデルの能力で判定する）。
  - `globalSetup`（`tests/e2e/helpers/global-setup.ts`）が、再利用した dev サーバーのモデルの不一致・モデル未取得を検出して開始前に止める（`/api/models` が 502 なら検証を省略）。
- 失敗時: スクリーンショット + トレースを保存
- テストファイル配置: `front/tests/e2e/`
- Base URL: `http://localhost:3000`
