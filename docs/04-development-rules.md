# 開発ルール

> 最終更新: 2026-07-11

## 目次

- [ディレクトリルール（最重要）](#ディレクトリルール最重要)
- [開発手法](#開発手法)
- [ドキュメント更新ルール](#ドキュメント更新ルール)
- [Git運用](#git運用)
- [テスト方針](#テスト方針)
  - [テストファイル配置](#テストファイル配置)
  - [CI（GitHub Actions）](#cigithub-actions)
- [コード品質](#コード品質)
- [技術規約](#技術規約)

## ディレクトリルール（最重要）

- **`base/` は読み取り専用**。ファイルの編集・追加・削除を絶対にしない。デザインリファレンスとしての参照のみ。
- **開発コードは全て `front/` ディレクトリ内に配置する**。Next.jsプロジェクト、設定ファイル、テスト等すべて `front/` 内で管理する。
- コマンド実行は `front/` ディレクトリ内で行う。

## 開発手法

**タスク駆動開発**を採用する。

1. タスクを `docs/07-tasks.md` にチェックリスト形式で管理する
2. タスクを1つずつ消化し、完了したら `[x]` に更新する
3. 新規タスクの追加・完了時は必ず `docs/07-tasks.md` を更新する
4. 指示ルールが変更・追加された場合は `CLAUDE.md` も必ず更新する

## ドキュメント更新ルール

| トリガー | 更新対象 |
|---------|---------|
| タスクの追加・着手・完了 | `docs/07-tasks.md` |
| 開発ルール・指示の変更 | `CLAUDE.md` + 該当docsファイル |
| 要件の追加・変更 | `docs/01-requirements.md` |
| 設計の変更 | `docs/02-architecture.md` or `docs/03-api-design.md` |

## Git運用

- **feature branch** 方式で運用する
- ブランチ名: `feature/<機能名>` または `docs/<ドキュメント名>`（例: `feature/chat-streaming`, `docs/setup-guide-macos`）
- mainブランチに直接コミットしない（初回セットアップ時を除く）
- **コミットメッセージは日本語**で記述する
- PRはGitHub Actionsの自動テスト通過後にマージ

## テスト方針

- **E2Eテスト**を必須とする（Playwright使用）
- コンポーネント単位のユニットテストは不要
- テスト観点:
  - **正常系**: 期待通りの動作確認
  - **準正常系**: 境界値、空入力、長文入力等
  - **異常系**: エラーハンドリング、通信失敗等
  - **画面操作**: ボタン押下、キーボード操作、スクロール等

### テストファイル配置

```
front/tests/
└── e2e/
    ├── helpers/
    │   └── test-data.ts           # テストデータ管理ヘルパー
    ├── chat.spec.ts               # チャット機能テスト
    ├── chat-streaming.spec.ts     # ストリーミング表示テスト
    ├── chat-loading.spec.ts       # ローディング表示テスト
    ├── sidebar.spec.ts            # サイドバー操作テスト
    ├── conversation.spec.ts       # 会話管理テスト
    ├── security.spec.ts           # セキュリティテスト
    ├── responsive.spec.ts         # レスポンシブテスト
    ├── agent.spec.ts              # エージェント基盤テスト（Phase A）
    ├── agent-phase-b.spec.ts      # 調査系ツールテスト（Phase B）
    ├── agent-phase-c.spec.ts      # 自律エージェントテスト（Phase C）
    ├── screenshot.spec.ts         # スクリーンショットテスト
    ├── debug-console.spec.ts      # デバッグ用テスト
    └── debug-input.spec.ts        # 入力方式デバッグ用テスト
```

### CI（GitHub Actions）

- `push` to main / `pull_request` to main で自動実行
- CI環境: Ubuntu + PostgreSQL (service container) + Ollama (`qwen2.5:0.5b`)
- CIではストリーミング完了テスト・スクリーンショットテスト・デバッグテストをスキップ
- 詳細は `docs/08-ci-e2e-bug-report.md` を参照

## コード品質

- **ESLint** + **Prettier** を導入する
- **JSDoc（TSDoc）規約を `eslint-plugin-jsdoc` で機械強制**する（`front/eslint.config.mjs`）。型ブレース禁止・`@param`/`@returns` の整合を `pnpm lint` で検出。規約は `.claude/rules/jsdoc.md` を参照
- 保存時の自動フォーマットを推奨
- リント・フォーマットコマンド:
  - `pnpm lint` — ESLintチェック
  - `pnpm format` — Prettierフォーマット

## 技術規約

- パッケージマネージャー: **pnpm**
- フレームワーク: **Next.js App Router**
- 言語: **TypeScript**（strict mode）
- スタイリング: **TailwindCSS**
- テストFW: **Playwright**（E2Eテスト）
- LLM通信: **Next.js Route Handlers**経由（フロントエンドから直接Ollamaを叩かない）
