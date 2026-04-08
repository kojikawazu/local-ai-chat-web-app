---
description: テスト方針・構成・実行方法
globs: "front/tests/**"
---

# テスト方針

- **E2E テスト必須**（Playwright）。コンポーネント単位のユニットテストは不要。
- **3分類必須**: 全テストファイルに正常系・準正常系・異常系を含める。
  - `describe('正常系')`, `describe('準正常系')`, `describe('異常系')` に分割する。
- **実環境テスト**: 実際の Ollama + PostgreSQL に接続してテスト実行。
- **テストデータ管理**: テストスイート（ファイル）単位でセットアップ/クリーンアップ。
- **CI スキップ**: ストリーミング完了テスト・スクリーンショットテスト・デバッグテストは CI スキップ。

## テストツール

| テスト種別 | ツール |
|-----------|--------|
| E2E テスト | Playwright（Chromium のみ） |
| スクリーンショット | Playwright（ビジュアルリグレッション） |

## Playwright 設定

- `workers: 1`（順次実行）、`retry: 1`、`webServer` で `pnpm dev` を自動起動
- 失敗時: スクリーンショット + トレースを保存
- テストファイル配置: `front/tests/e2e/`
- Base URL: `http://localhost:3000`
