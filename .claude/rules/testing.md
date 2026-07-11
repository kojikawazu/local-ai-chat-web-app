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
- **実環境テスト（E2E）**: 実際の Ollama + PostgreSQL に接続してテスト実行。
- **テストデータ管理**: テストスイート（ファイル）単位でセットアップ/クリーンアップ。
- **CI スキップ**: ストリーミング完了テスト・スクリーンショットテスト・デバッグテストは CI スキップ。

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
- 失敗時: スクリーンショット + トレースを保存
- テストファイル配置: `front/tests/e2e/`
- Base URL: `http://localhost:3000`
