---
description: テスト方針・構成・実行方法
globs: "front/tests/**"
---

# テスト方針

- **2層構成**: ユニットテスト（UT / Vitest）+ E2E テスト（Playwright）。
  - **UT**: 外部 I/O 非依存の純ロジック（バリデーション・式評価・プリセット探索等）を対象とする。
  - **E2E 必須**: 実際の Ollama + PostgreSQL に接続して主要フローを検証する。
  - **UI コンポーネント単位のユニットテストは不要**（E2E で担保する）。
- **3分類必須**: UT・E2E とも全テストファイルに正常系・準正常系・異常系を含める。
  - `describe('正常系')`, `describe('準正常系')`, `describe('異常系')` に分割する。
- **実環境テスト（E2E）**: 実際の Ollama + PostgreSQL に接続してテスト実行。
- **テストデータ管理**: テストスイート（ファイル）単位でセットアップ/クリーンアップ。
- **CI スキップ**: ストリーミング完了テスト・スクリーンショットテスト・デバッグテストは CI スキップ。

## テストツール

| テスト種別 | ツール | 配置 |
|-----------|--------|------|
| ユニットテスト（UT） | Vitest（node 環境） | `front/tests/unit/` |
| E2E テスト | Playwright（Chromium のみ） | `front/tests/e2e/` |
| スクリーンショット | Playwright（ビジュアルリグレッション） | `front/tests/e2e/` |

## UT（Vitest）方針

- **対象**: 外部 I/O 非依存の純ロジック（例: `lib/validation.ts`・`lib/tools/calculate.ts`・`lib/agent-prompts.ts`）。
- **モック方針**: 外部 I/O（fetch / DB 等）のみモック。**ビジネスロジックはモックしない**（実装追認・ハッピーパス偏重を避ける）。今回の初期対象は純関数のため mock を一切使わない。
- **実行**: `pnpm test:unit`（CI では専用 `unit-test` ジョブ。Ollama / DB 不要で数十秒で完了、E2E と独立）。
- **設定**: `front/vitest.config.ts`（`tests/unit/**` のみ対象、`@/*` エイリアス解決）。

## Playwright 設定

- `workers: 1`（順次実行）、`retry: 1`、`webServer` で `pnpm dev` を自動起動
- 失敗時: スクリーンショット + トレースを保存
- テストファイル配置: `front/tests/e2e/`
- Base URL: `http://localhost:3000`
