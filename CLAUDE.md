# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 運用ルール（最重要）

1. **タスクの追加・着手・完了時は `docs/07-tasks.md` を必ず更新する**
2. **指示ルール・開発ルールが変更されたら `CLAUDE.md` を必ず更新する**
3. 要件・設計の変更時は該当する `docs/` 内ドキュメントも更新する
4. **`base/` は読み取り専用。ファイルの編集・追加・削除を絶対にしない**
5. **開発コードは全て `front/` ディレクトリ内に配置する**

## プロジェクト概要

ローカルLLM（Ollama）と対話するチャットWebアプリケーション。
Nordic Frostデザインシステムによるチャットインターフェース。
会話履歴をPostgreSQLに永続化する。

## 技術スタック

| 項目 | 技術 |
|------|------|
| フレームワーク | Next.js 16 (App Router) + TypeScript 5 |
| React | React 19 — React Compiler有効（`next.config.ts`で`reactCompiler: true`） |
| スタイリング | TailwindCSS 4 |
| アイコン | lucide-react |
| Markdown表示 | react-markdown + remark-gfm |
| パッケージマネージャー | pnpm |
| LLM | Ollama — デフォルト `qwen3-coder-next:latest`（動的にモデル切替可能） |
| DB | PostgreSQL 16（Docker Compose） |
| ORM | Prisma 7（クライアント出力先: `src/generated/prisma/`） |
| E2Eテスト | Playwright |
| リンター | ESLint 9 + eslint-config-prettier + eslint-plugin-jsdoc（JSDoc規約の機械強制） |
| フォーマッター | Prettier |

## コマンド

全コマンドは `front/` ディレクトリ内で実行する。

```bash
cd front
pnpm install         # 依存パッケージインストール
pnpm dev             # 開発サーバー起動
pnpm build           # プロダクションビルド
pnpm lint            # ESLintチェック
pnpm format          # Prettierフォーマット
pnpm test:e2e        # Playwright E2Eテスト全実行
```

### 単一テスト実行

```bash
cd front
pnpm test:e2e tests/e2e/chat.spec.ts              # 特定ファイルのみ実行
pnpm test:e2e --grep "メッセージ送信"               # テスト名で絞り込み
pnpm test:e2e tests/e2e/chat.spec.ts --headed      # ブラウザ表示付き実行
```

### DB関連

```bash
docker compose up -d                    # PostgreSQL起動（プロジェクトルートで実行）
cd front && pnpm prisma migrate dev     # マイグレーション実行
cd front && pnpm prisma studio          # Prisma Studio（DBブラウザ）
cd front && pnpm prisma generate        # Prismaクライアント再生成
```

## 環境変数

`front/.env.local` に設定:

| 変数名 | 説明 | デフォルト |
|--------|------|-----------|
| `OLLAMA_BASE_URL` | Ollama API接続先 | `http://localhost:11434` |
| `OLLAMA_MODEL` | 使用モデル | `qwen3-coder-next:latest` |
| `DATABASE_URL` | PostgreSQL接続文字列 | `postgresql://postgres:postgres@localhost:5499/chat_db` |
| `AGENT_MAX_TOOL_ROUNDS` | エージェントループの最大ラウンド数 | `10` |
| `AGENT_TOOL_TIMEOUT_MS` | ツール実行タイムアウト（ms） | `30000` |

## 開発手法

- **タスク駆動開発**: `docs/07-tasks.md` のチェックリストを1つずつ消化する
- **feature branch運用**: `feature/<機能名>` でブランチを切り、mainにマージ
- **コミットメッセージは日本語**で記述する

## アーキテクチャ

```
ブラウザ → Next.js Route Handlers → Ollama API (localhost:11434)
                                  → Agent Loop → Tool Executor（ツール実行）
                                  → Prisma ORM → PostgreSQL (Docker)
```

- フロントエンドからOllamaへの直接通信はしない。Route Handlersを経由する。
- ストリーミングは `ReadableStream` を使用しリアルタイム中継。
- 状態管理はReact `useState`。グローバルstate管理ライブラリは使わない。
- 会話履歴はPostgreSQLに永続化。Conversation → Message のリレーション（カスケード削除）。
- パスエイリアス: `@/*` → `./src/*`（tsconfig.json）
- Prismaクライアントは `src/generated/prisma/` に生成。インポートは `@/generated/prisma/client`（`database.md` 参照）

### API エンドポイント一覧

| メソッド | パス | 用途 |
|---------|------|------|
| POST | `/api/chat` | Ollamaにメッセージ送信（ストリーミング応答、model/enableTools/systemPrompt指定可） |
| GET | `/api/models` | Ollamaの利用可能モデル一覧取得 |
| GET | `/api/tools` | エージェントの利用可能ツール一覧取得 |
| GET | `/api/conversations` | 会話一覧取得 |
| POST | `/api/conversations` | 新規会話作成 |
| DELETE | `/api/conversations/[id]` | 会話削除（メッセージもカスケード削除） |
| GET | `/api/conversations/[id]/messages` | 会話のメッセージ一覧取得 |
| POST | `/api/conversations/[id]/messages` | メッセージ保存 |
| POST | `/api/conversations/[id]/generate-title` | LLMで会話タイトル自動生成 |

詳細は `docs/03-api-design.md`・`.claude/rules/api.md` を参照。

DBスキーマ詳細は `.claude/rules/database.md` を参照。

## ディレクトリ構成

### プロジェクト全体

- **`.github/workflows/`** — GitHub Actions CI定義（E2Eテスト自動実行）
- **`base/`** — UIデザインリファレンス（読み取り専用。編集禁止）
- **`docs/`** — プロジェクトドキュメント
- **`manuals/`** — セットアップガイド等のマニュアル
- **`front/`** — Next.jsアプリケーション本体（開発はここで行う）
- **`docker-compose.yml`** — PostgreSQLコンテナ定義（プロジェクトルート）

### front/src/ ソースコード構成（ハイブリッド方式）

- **`app/`** — Next.js App Router（ページ、レイアウト、Route Handlers）
  - `api/chat/` — Ollamaストリーミング通信（model指定可）
  - `api/models/` — 利用可能モデル一覧取得
  - `api/conversations/` — 会話CRUD
  - `api/conversations/[id]/generate-title/` — LLMでタイトル自動生成
- **`components/`** — 共通UIコンポーネント（SettingsModal等、複数機能で再利用）
- **`features/`** — 機能固有モジュール（各機能に components/, hooks/ を内包）
  - `features/chat/` — チャット機能（ChatWindow, ChatBar, Header, Footer, MarkdownContent, ToolCallIndicator, ToolCallResult, AgentThinking, useChat）
  - `features/sidebar/` — サイドバー機能（Sidebar, useConversations）
- **`generated/prisma/`** — Prisma自動生成クライアント
- **`hooks/`** — 共通カスタムフック（useTheme等）
- **`lib/`** — ユーティリティ（ollama.ts, prisma.ts, validation.ts, agent.ts, agent-prompts.ts）
  - `lib/tools/` — ツール実装（types.ts, index.ts, registry.ts, get-current-datetime.ts, calculate.ts, web-search.ts, url-fetch.ts）
- **`types/`** — 共通型定義

### デザインリファレンス（base/ — 読み取り専用）

`base/themes.ts`（配色）・`base/App.tsx`（全体レイアウト）・`base/types.ts`（型定義）・`base/components/`（実装参考）

## テスト方針

- **E2Eテスト必須**（Playwright）。正常系・準正常系・異常系の3分類必須。
- **CI**: push/PR to main で自動実行。CIモデル: `qwen2.5:0.5b`
- テストファイル配置: `front/tests/e2e/`
- 詳細は `.claude/rules/testing.md`・`docs/06-testing.md` を参照

## テーマ・セキュリティ

- テーマ: CSS変数ベース3テーマ切替（Nordic Frost / Aurora Borealis / Midnight Ocean）。詳細は `.claude/rules/frontend.md` を参照
- セキュリティ: 認証不要（localhost個人利用）。詳細は `.claude/rules/security.md`・`docs/05-security.md` を参照

## ドキュメント一覧

| ファイル | 内容 |
|---------|------|
| `docs/README.md` | ドキュメント目次（インデックス） |
| `docs/01-requirements.md` | 要件定義 |
| `docs/02-architecture.md` | アーキテクチャ設計 |
| `docs/03-api-design.md` | API設計 |
| `docs/04-development-rules.md` | 開発ルール詳細 |
| `docs/05-security.md` | セキュリティ要件 |
| `docs/06-testing.md` | テスト要件 |
| `docs/07-tasks.md` | タスク一覧・進捗管理 |
| `docs/08-ci-e2e-bug-report.md` | CI E2Eテスト バグレポート |
| `docs/09-agent-architecture.md` | エージェント機能 設計書 |
| `docs/10-roadmap.md` | 開発ロードマップ |
| `manuals/setup-guide-macos.md` | macOS向けセットアップガイド |

新規ドキュメント追加時は次の連番（`11-`〜）を付与する。

## Instruction Shortcuts

以下の短い指示は、対応するフルアクションとして解釈・実行してください。

| 指示 | アクション |
|------|-----------|
| PR承認しました | main ブランチを pull → マージ済みブランチを削除 → main に切り替え |
| PR出して | 変更をコミット → push → PR 作成 |
| Copilotにレビュー依頼出して | PR のコメントで `@copilot` メンション付きでレビュー依頼を投稿 |
| Copilotからレビュー来ました | PR のレビューコメントを取得・内容を確認・必要な対応を実施 |
| 〇〇を参考にしてください | 参考先は **read-only**（参考先のファイルやリポジトリを変更しない） |

## Rules

明示的な指示がなくても、以下のルールを常に守ってください。

### 開発フロー

- **ブランチ運用**: 開発を開始する際は、必ず作業ブランチを切ってから着手する。main ブランチで直接作業しない。
- **テスト必須**: 実装時はテストコードも必ず書く。

### 品質ゲート

- **セルフレビュー必須**: 要求仕様の作成・ドキュメント生成・設計・実装が完了したら、次のフェーズに進む前にセルフレビューを実施する。
- **セルフレビュー後の修正**: セルフレビューで指摘を検出したら、修正まで実施する。
- **設計完了時**: 要求仕様との齟齬がないか確認し、ユーザーにレビューしてもらう。レビュー完了まで実装に進まない。
- **実装完了時**: 設計仕様との齟齬がないか確認し、ユーザーにレビューしてもらう。

### ドキュメント

- **ドキュメント更新**: 作業が完了したら、ルートドキュメント（CLAUDE.md / README.md / docs/）の更新が必要かどうか確認し、必要であれば更新する。

### スタック別ルール（`.claude/rules/`）

| ファイル | スコープ | 内容 |
|---------|---------|------|
| `coding-standards.md` | 全体 | TypeScript strict / pnpm / ESLint+Prettier / シークレット禁止 |
| `jsdoc.md` | `front/src/**` | JSDoc（TSDoc）規約・公開シンボルに必須・型ブレース禁止・キャスト/回避策に "why" |
| `error-handling.md` | 全体 | バリデーション・HTTP ステータス・統一エラーレスポンス方針 |
| `security.md` | 全体 | XSS 対策・SQL インジェクション禁止・CSP・シークレット管理 |
| `testing.md` | `front/tests/**` | E2E テスト方針・3分類必須・Playwright 設定 |
| `frontend.md` | `front/src/components/**` 等 | Next.js App Router・ドメイン別構成・React Compiler・テーマ |
| `api.md` | `front/src/app/api/**` | Route Handlers 設計・NDJSON ストリーミング・バリデーション |
| `database.md` | `front/prisma/**` 等 | Prisma 命名規約・スキーマ・マイグレーション・クエリルール |
| `documentation.md` | 全体 | ドキュメント乖離防止・影響マップ（変更種別→更新必須ドキュメント）・opt-out 完了条件 |
