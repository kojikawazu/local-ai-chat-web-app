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
| Markdown表示 | react-markdown + remark-gfm + rehype-highlight（コードブロックのシンタックスハイライト）+ mermaid（Mermaid の図。使うときだけ読み込む） |
| パッケージマネージャー | pnpm |
| LLM | Ollama — デフォルト `qwen3.8:27b`（動的にモデル切替可能） |
| DB | PostgreSQL 16（Docker Compose） |
| Web検索 | SearXNG（Docker Compose。`web_search` ツールの検索エンジン） |
| 図の描画 | mermaid（ブラウザ内）・PlantUML サーバー（Docker Compose。`PLANTUML_SECURITY_PROFILE=SANDBOX`） |
| ORM | Prisma 7（クライアント出力先: `src/generated/prisma/`） |
| ユニットテスト | Vitest（純ロジック対象） |
| インテグレーションテスト | Vitest + Testcontainers（実PostgreSQL） |
| E2Eテスト | Playwright |
| リンター | ESLint 9 + eslint-config-prettier + eslint-plugin-jsdoc（JSDoc規約の機械強制）+ `consistent-type-imports`（`import type` の機械強制） |
| フォーマッター | Prettier |

## コマンド

全コマンドは `front/` ディレクトリ内で実行する。

```bash
cd front
pnpm install         # 依存パッケージインストール
pnpm dev             # 開発サーバー起動
pnpm build           # プロダクションビルド
pnpm lint            # ESLintチェック
pnpm format          # Prettierフォーマット（front 配下全体。.prettierignore で除外制御）
pnpm format:check    # Prettier 差分チェック（書き換えずに検出。CIで実行）
pnpm typecheck       # tsc --noEmit による型チェック
pnpm test:unit       # Vitest ユニットテスト全実行
pnpm test:integration # Vitest+Testcontainers インテグレーションテスト（Docker必須）
pnpm test:e2e        # Playwright E2Eテスト全実行（既定モデル qwen2.5:0.5b。要 `ollama pull qwen2.5:0.5b`）
```

ルート直下の `Makefile` から上記コマンドを短縮実行できる（`make dev` / `make test` / `make db-up` 等）。`make` 単体でターゲット一覧を表示。Makefile は pnpm / docker compose の薄いラッパーであり、コマンドの正準は本節の pnpm スクリプトとする。

### 単一ユニットテスト実行

```bash
cd front
pnpm test:unit tests/unit/calculate.test.ts        # 特定ファイルのみ実行
pnpm test:unit -t "正常系"                          # テスト名で絞り込み
pnpm test:unit:watch                                # 監視モード
```

### 単一テスト実行

```bash
cd front
pnpm test:e2e tests/e2e/chat.spec.ts              # 特定ファイルのみ実行
pnpm test:e2e --grep "メッセージ送信"               # テスト名で絞り込み
pnpm test:e2e tests/e2e/chat.spec.ts --headed      # ブラウザ表示付き実行
E2E_OLLAMA_MODEL=qwen3.8:27b pnpm test:e2e  # 大モデルで実行（ツール呼び出し依存のテストも走る）
```

E2E のモデルは `E2E_OLLAMA_MODEL`（既定 `qwen2.5:0.5b`）で決まり、`playwright.config.ts` が dev サーバーへ `OLLAMA_MODEL` として渡す（`.env.local` の大モデルを読み込ませないため）。起動済みの `pnpm dev` を別モデルで再利用している場合・モデル未取得の場合は、開始前に `tests/e2e/helpers/global-setup.ts` が止める。

### DB関連

```bash
docker compose up -d                    # PostgreSQL・SearXNG・PlantUML起動（プロジェクトルートで実行）
cd front && pnpm prisma migrate dev     # マイグレーション実行
cd front && pnpm prisma studio          # Prisma Studio（DBブラウザ）
cd front && pnpm prisma generate        # Prismaクライアント再生成
```

## 環境変数

`front/.env.local` に設定:

| 変数名 | 説明 | デフォルト |
|--------|------|-----------|
| `OLLAMA_BASE_URL` | Ollama API接続先 | `http://localhost:11434` |
| `OLLAMA_MODEL` | 使用モデル | `qwen3.8:27b` |
| `DATABASE_URL` | PostgreSQL接続文字列 | `postgresql://postgres:postgres@localhost:5499/chat_db` |
| `AGENT_MAX_TOOL_ROUNDS` | エージェントループの最大ラウンド数 | `10` |
| `AGENT_TOOL_TIMEOUT_MS` | ツール実行タイムアウト（ms） | `30000` |
| `SEARXNG_URL` | Web検索（`web_search`）の SearXNG 接続先 | `http://localhost:8888` |
| `PLANTUML_URL` | PlantUML の図を描く PlantUML サーバーの接続先 | `http://localhost:8889` |

## 開発手法

- **タスク駆動開発**: `docs/07-tasks.md` のチェックリストを1つずつ消化する
- **feature branch運用**: `<種別>/<名前>`（種別: `feature` / `fix` / `chore` / `docs` / `test`）でブランチを切り、mainにマージ。種別の使い分けは `docs/04-development-rules.md` を参照
- **コミットメッセージは日本語**で記述する

## アーキテクチャ

```
ブラウザ → Next.js Route Handlers → Ollama API (localhost:11434)
                                  → Agent Loop → Tool Executor（ツール実行）→ SearXNG (Docker・Web検索)
                                  → Prisma ORM → PostgreSQL (Docker)
                                  → PlantUML サーバー (Docker・図の描画)
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
| POST | `/api/chat` | Ollamaにメッセージ送信（ストリーミング応答、model/enableTools/systemPrompt指定可。systemPrompt は通常・エージェントとも先頭の system メッセージになり、後ろに現在の日時が付く） |
| GET | `/api/models` | Ollamaの利用可能モデル一覧取得 |
| GET | `/api/tools` | エージェントの利用可能ツール一覧取得 |
| GET | `/api/conversations` | 会話一覧取得 |
| GET | `/api/conversations/search` | 会話のキーワード検索（タイトル・本文。空白区切りの AND、20 件ずつ） |
| POST | `/api/conversations` | 新規会話作成（会話の役割 `systemPrompt` を指定可） |
| PATCH | `/api/conversations/[id]` | 会話の役割（システムプロンプト）の変更 |
| DELETE | `/api/conversations/[id]` | 会話削除（メッセージもカスケード削除） |
| GET | `/api/conversations/[id]/messages` | 会話のメッセージ一覧取得 |
| POST | `/api/conversations/[id]/messages` | メッセージ保存（クライアント採番の `id` を指定可） |
| PUT | `/api/conversations/[id]/messages/[messageId]` | 応答の置き換え（再生成） |
| POST | `/api/conversations/[id]/generate-title` | LLMで会話タイトル自動生成 |
| POST | `/api/diagrams/plantuml` | PlantUML のソースを PlantUML サーバーで SVG にして返す |

詳細は `docs/03-api-design.md`・`.claude/rules/api.md` を参照。

DBスキーマ詳細は `.claude/rules/database.md` を参照。

## ディレクトリ構成

### プロジェクト全体

- **`.github/workflows/`** — GitHub Actions CI定義（Quality / UT / IT / E2E の4ジョブ。ドキュメントのみの変更では発火しない。加えて Workflow Lint・Secret scan を常時実行）。アクションの版更新は `.github/dependabot.yml`（Dependabot・週次）
- **`base/`** — UIデザインリファレンス（読み取り専用。編集禁止）
- **`docs/`** — プロジェクトドキュメント（`docs/models/` は使用 LLM モデルの評価）
- **`manuals/`** — セットアップガイド等のマニュアル
- **`front/`** — Next.jsアプリケーション本体（開発はここで行う）
- **`docker-compose.yml`** — PostgreSQL・SearXNG（Web検索）・PlantUML（図の描画）のコンテナ定義（プロジェクトルート）
- **`searxng/`** — SearXNG の設定（`settings.yml`。JSON API の有効化・Web 検索のエンジンの追加等。`docker-compose.yml` がマウントする）

### front/src/ ソースコード構成（層 → 機能）

- **`app/`** — Next.js App Router（ページ、レイアウト、Route Handlers）
  - `api/chat/` — Ollamaストリーミング通信（model指定可）
  - `api/models/` — 利用可能モデル一覧取得
  - `api/conversations/` — 会話CRUD
  - `api/conversations/search/` — 会話のキーワード検索
  - `api/conversations/[id]/generate-title/` — LLMでタイトル自動生成
  - `api/diagrams/plantuml/` — PlantUML の図の描画（PlantUML サーバーへ中継）
- **`hooks/`・`lib/`・`types/`・`constants/` の中は機能ごとのディレクトリに分ける**（`src/<層>/<機能>/`。直下にファイルを置かない。#160）
- **UI コンポーネントは Atomic Design**（#163・`docs/12-ui-components.md`）: 共通の部品は `components/common/{atoms,molecules,templates}/`、機能の部品は `components/features/<機能>/{atoms,molecules,organisms}/`。page（`app/page.tsx`）はフックを呼び、organisms を組み立てて template へ渡すだけ
- **`components/`** — UIコンポーネント（Atomic Design）
  - `common/atoms/` — Button, IconButton, ToggleChip, Switch, TextInput, TextArea, Select, Mark, StatusDot, LoadingDots
  - `common/molecules/` — Modal, SearchBox, CopyButton
  - `common/templates/` — ChatLayout（画面の枠）
  - `features/chat/` — チャット（molecules: ToolCallIndicator, WebSearchResult, DiagramView / organisms: ChatWindow, ChatBar, Header, Footer, MarkdownContent, RoleDialog, ExportDialog, ToolCallResult, AgentThinking）
  - `features/sidebar/` — サイドバー（molecules: ConversationListItem, SearchResultItem / organisms: Sidebar, SidebarDrawer, SidebarContent, ConversationSearch）
  - `features/settings/` — 設定（organisms: SettingsModal）
- **`constants/`** — 定数（`chat/toolLabels.ts`）
- **`generated/prisma/`** — Prisma自動生成クライアント
- **`hooks/`** — カスタムフック（`chat/{useChat,useModels,useMermaidDiagram,usePlantUmlDiagram}`・`sidebar/{useConversations,useConversationSearch,useDrawerDialog}`・`settings/useAgentSettings`・`theme/useTheme`・`clipboard/useCopyFeedback`）
- **`lib/`** — ユーティリティ・外部連携
  - `lib/agent/` — エージェント（agent.ts, agent-config.ts, agent-prompts.ts）
    - `lib/agent/tools/` — ツール実装（types.ts, index.ts, output.ts, registry.ts, get-current-datetime.ts, calculate.ts, web-search.ts, url-fetch.ts, read-body.ts）
  - `lib/llm/` — LLM との通信（ollama.ts, current-date.ts）
  - `lib/chat/` — チャット（chat-state.ts, conversation-history.ts, message-metadata.ts, regenerate.ts, system-prompt.ts, code-block.ts, diagram.ts, export.ts）
  - `lib/conversation/` — 会話（search.ts）
  - `lib/server/` — サーバー専用（prisma.ts, request-body.ts, plantuml.ts）
  - `lib/shared/` — サーバー・クライアント共通（validation.ts, class-names.ts, clipboard.ts, download.ts）
- **`types/`** — 機能をまたぐ共通型（agent/tool-call.ts: ToolCallInfo、chat/message.ts: Message/HistoryEntry、chat/diagram.ts: DiagramKind/DiagramState、conversation/conversation.ts: Conversation/ConversationSearchResult、theme/theme.ts: THEMES/ThemeId）

### デザインリファレンス（base/ — 読み取り専用）

`base/themes.ts`（配色）・`base/App.tsx`（全体レイアウト）・`base/types.ts`（型定義）・`base/components/`（実装参考）

## テスト方針

- **3層構成**: ユニット（Vitest / 純ロジック）+ インテグレーション（Vitest + Testcontainers / 実DB）+ E2E（Playwright / 実環境）。UIコンポーネント単位のUTは不要。
- **UT**: 外部I/O非依存の純ロジックを対象。外部I/Oのみモック・ビジネスロジックはモックしない。配置: `front/tests/unit/`
- **IT**: route handler をブラウザ抜きで実PostgreSQL（Testcontainers）相手に検証。実依存（DB）は使い、mockは真の外部（Ollama/Web）のみ。配置: `front/tests/integration/`
- **E2Eテスト必須**（Playwright）。実際のOllama + PostgreSQLに接続。配置: `front/tests/e2e/`
- **3分類必須**: UT・IT・E2Eとも正常系・準正常系・異常系に分割。
- **CI**: push/PR to main で自動実行。品質（`quality`: lint / format:check / typecheck）・UT（`unit-test`）・IT（`integration-test`）・E2E（`e2e-test`）は独立ジョブ。E2Eモデル: `qwen2.5:0.5b`（ローカル・CI 共通。`E2E_OLLAMA_MODEL` で上書き）。ワークフロー定義は Workflow Lint（`workflow-lint.yml`: actionlint・4 本の `on:` の一致検査）が、秘匿ファイルの追跡は Secret scan（`secret-scan.yml`）が常時検査
- **CI 発火除外**: ドキュメントのみの変更（`docs/**`・`manuals/**`・`**.md`・`.claude/**`・`LICENSE`）では 4 本とも発火しない（`paths-ignore`。Workflow Lint・Secret scan は常時実行）
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
| `docs/11-syntax-highlight-diagrams.md` | シンタックスハイライト・図表レンダリング 設計書 |
| `docs/12-ui-components.md` | UI コンポーネント 設計書（Atomic Design） |
| `docs/models/` | LLM モデル評価（`README.md` に比較、モデルごとに 1 ファイル） |
| `manuals/setup-guide-macos.md` | macOS向けセットアップガイド |

新規ドキュメント追加時は次の連番（`13-`〜）を付与する。

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
| `typescript.md` | `front/src/**` | TypeScript 固有規約・type/interface の使い分け・型/定数の配置・any 禁止・enum 回避・`import type` |
| `jsdoc.md` | `front/src/**` | JSDoc（TSDoc）規約・公開シンボルに必須・型ブレース禁止・キャスト/回避策に "why" |
| `error-handling.md` | 全体 | バリデーション・HTTP ステータス・統一エラーレスポンス方針 |
| `security.md` | 全体 | XSS 対策・SQL インジェクション禁止・CSP・シークレット管理 |
| `testing.md` | `front/tests/**` | E2E テスト方針・3分類必須・Playwright 設定 |
| `frontend.md` | `front/src/components/**` 等 | Next.js App Router・ドメイン別構成・React Compiler・テーマ |
| `api.md` | `front/src/app/api/**` | Route Handlers 設計・NDJSON ストリーミング・バリデーション |
| `database.md` | `front/prisma/**` 等 | Prisma 命名規約・スキーマ・マイグレーション・クエリルール |
| `documentation.md` | 全体 | ドキュメント乖離防止・影響マップ（変更種別→更新必須ドキュメント）・opt-out 完了条件 |
| `github-issue.md` | 全体 | GitHub issue 運用・ブランチと対で起票・`Closes #N` で自動クローズ・サブ issue |
| `github-actions.md` | `.github/workflows/**` | ワークフロー規約・最小権限・concurrency・4 本の `on:` の同期（Workflow Lint で検査）・actionlint・常時実行の検査（Secret scan）・Dependabot によるアクション更新 |
