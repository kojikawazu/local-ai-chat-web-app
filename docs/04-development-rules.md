# 開発ルール

> 最終更新: 2026-10-17

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
- **GitHub issue 運用**: 作業ブランチを切るのと対で issue を起票し、open/close で進捗を管理する。PR 本文に `Closes #<issue番号>` を記載して自動クローズする。詳細は `.claude/rules/github-issue.md` を参照

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
    │   ├── test-data.ts           # テストデータ管理ヘルパー
    │   ├── model.ts               # E2E のモデル解決（E2E_OLLAMA_MODEL・軽量モデル判定）
    │   └── global-setup.ts        # 開始前に dev サーバーのモデル・モデル取得済みを検証
    ├── chat.spec.ts               # チャット機能テスト
    ├── chat-streaming.spec.ts     # ストリーミング表示テスト
    ├── chat-loading.spec.ts       # ローディング表示テスト
    ├── sidebar.spec.ts            # サイドバー操作テスト
    ├── conversation.spec.ts       # 会話管理テスト
    ├── security.spec.ts           # セキュリティテスト
    ├── responsive.spec.ts         # レスポンシブテスト
    ├── mobile-navigation.spec.ts  # モバイルのドロワーから会話管理・設定へ到達できるか
    ├── theme.spec.ts              # テーマ切替・localStorage永続化テスト
    ├── agent.spec.ts              # エージェント基盤テスト（Phase A）
    ├── agent-phase-b.spec.ts      # 調査系ツールテスト（Phase B）
    ├── agent-phase-c.spec.ts      # 自律エージェントテスト（Phase C）
    ├── agent-metadata.spec.ts     # エージェント応答の付随情報（思考過程・統計）の復元
    └── screenshot.spec.ts         # スクリーンショットテスト
```

### CI（GitHub Actions）

- `push` to main / `pull_request` to main で自動実行
- **ドキュメントのみの変更（`docs/**`・`manuals/**`・`**.md`・`.claude/**`・`LICENSE`）では 3 ジョブとも発火しない**（`paths-ignore`）。コードとドキュメントが混在する変更では通常どおり実行される。詳細は `.claude/rules/testing.md`「CI の発火条件」を参照
- CI環境: Ubuntu + PostgreSQL (service container) + Ollama (`qwen2.5:0.5b`)
- CIではストリーミング完了テスト・スクリーンショットテストをスキップ
- 詳細は `docs/08-ci-e2e-bug-report.md` を参照

## コード品質

- **ESLint** + **Prettier** を導入する
- **JSDoc（TSDoc）規約を `eslint-plugin-jsdoc` で機械強制**する（`front/eslint.config.mjs`）。型ブレース禁止・`@param`/`@returns` の整合を `pnpm lint` で検出。規約は `.claude/rules/jsdoc.md` を参照
- **TypeScript 固有規約**（type/interface の使い分け・型/定数の配置・`any` 禁止・`enum` 回避・`import type`・`as`/`!` 抑制）は `.claude/rules/typescript.md` を参照
- **`import type` を `@typescript-eslint/consistent-type-imports` で機械強制**する（`fixStyle: separate-type-imports`）。`tsconfig.json` の `verbatimModuleSyntax: true` と併せて、型 import が実行時に残らないことを保証する
- 保存時の自動フォーマットを推奨
- **CI の `quality` ジョブで `lint` / `format:check` / `typecheck` を機械強制**する（ローカル実行に依存しない）
- **整形コミットは機能変更と分離**し、`.git-blame-ignore-revs` に登録する
- リント・フォーマットコマンド:
  - `pnpm lint` — ESLintチェック
  - `pnpm format` — Prettierフォーマット（`front/` 配下全体）
  - `pnpm format:check` — Prettier 差分チェック（書き換えない）
  - `pnpm typecheck` — `tsc --noEmit` による型チェック

## 技術規約

- パッケージマネージャー: **pnpm**
- フレームワーク: **Next.js App Router**
- 言語: **TypeScript**（strict mode）
- スタイリング: **TailwindCSS**
- テストFW: **Playwright**（E2Eテスト）
- LLM通信: **Next.js Route Handlers**経由（フロントエンドから直接Ollamaを叩かない）
