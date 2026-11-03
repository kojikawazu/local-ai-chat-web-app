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
| HTML レポート | unified + remark-parse + remark-rehype + hast-util-to-html（応答・会話の HTML / PDF と、応答の HTML スライドの書き出し。画面と同じ remark-gfm・rehype-highlight を使う） |
| DOCX | docx（応答・会話の Word の書き出し。書き出すときだけ読み込む。テストは jszip で中身を読む） |
| PPTX | pptxgenjs（応答の PowerPoint の書き出し。書き出すときだけ読み込む。テストは jszip で中身を読む。依存の `image-size` は `pnpm.overrides` で 2.x に上げている。#231） |
| 差分 | diff（jsdiff。ファイルの書き込みの承認カードの unified diff） |
| パッケージマネージャー | pnpm |
| LLM | Ollama — デフォルト `qwen3.8:27b`（動的にモデル切替可能） |
| DB | PostgreSQL 16 + pgvector（Docker Compose。イメージ `pgvector/pgvector:0.8.6-pg16-trixie`） |
| RAG | Ollama の埋め込み（既定 `embeddinggemma:300m`）+ pgvector（次元を決めない `vector` の列・索引なしで全件と比べる。#17） |
| Web検索 | SearXNG（Docker Compose。`web_search` ツールの検索エンジン） |
| 図の描画 | mermaid（ブラウザ内）・PlantUML サーバー（Docker Compose。`PLANTUML_SECURITY_PROFILE=SANDBOX`） |
| ブラウザの操作 | playwright-core（エージェントのブラウザのツール。Chromium はヘッドレス。`@playwright/test` と同じ版に揃える） |
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
pnpm test:e2e        # Playwright E2Eテスト全実行（既定モデル qwen2.5:0.5b・埋め込み embeddinggemma:300m。要 `ollama pull` の両方）
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

E2E のモデルは `E2E_OLLAMA_MODEL`（既定 `qwen2.5:0.5b`）で決まり、`playwright.config.ts` が dev サーバーへ `OLLAMA_MODEL` として渡す（`.env.local` の大モデルを読み込ませないため）。埋め込みのモデル（RAG。#17）はアプリの既定と同じ `embeddinggemma:300m` を `OLLAMA_EMBED_MODEL` として渡す。起動済みの `pnpm dev` を別モデルで再利用している場合・モデル未取得の場合は、開始前に `tests/e2e/helpers/global-setup.ts` が止める。

### DB関連

```bash
docker compose up -d                    # PostgreSQL・SearXNG・PlantUML起動（プロジェクトルートで実行）
cd front && pnpm prisma migrate dev     # マイグレーション実行
cd front && pnpm prisma studio          # Prisma Studio（DBブラウザ）
cd front && pnpm prisma generate        # Prismaクライアント再生成
```

## 環境変数

`front/.env.local` に設定する。Prisma の CLI（`pnpm prisma migrate dev` 等）も `front/prisma.config.ts` で同じ `.env.local` を読む（無い値だけ `.env` から足す。すでに環境変数にある値は上書きしない。#229）:

| 変数名 | 説明 | デフォルト |
|--------|------|-----------|
| `OLLAMA_BASE_URL` | Ollama API接続先 | `http://localhost:11434` |
| `OLLAMA_MODEL` | 使用モデル | `qwen3.8:27b` |
| `OLLAMA_EMBED_MODEL` | RAG のドキュメントの埋め込みのモデル（変えたら取り込んだドキュメントの作り直しが要る） | `embeddinggemma:300m` |
| `KNOWLEDGE_VAULTS` | RAG の保管庫にする手元のノートのリポジトリ・フォルダの絶対パス（カンマ区切り・`~` 可。ドキュメントのダイアログの「同期」で取り込む。git のリポジトリは既定のブランチ（main）のコミット済みの中身だけを読む。#235） | 未設定（保管庫を使わない） |
| `KNOWLEDGE_MEMORY_VAULT` | 会話から覚えさせたことをエージェントが書く保管庫の名前（`KNOWLEDGE_VAULTS` の保管庫のフォルダ名。`save_memory` のツールで `memories/<名前>.md` に書き、実行前に承認が要る。git のリポジトリなら main にコミットする（push しない）。#236） | 未設定（メモを書くツールを使わない） |
| `DATABASE_URL` | PostgreSQL接続文字列 | `postgresql://postgres:postgres@localhost:5499/chat_db` |
| `AGENT_MAX_TOOL_ROUNDS` | エージェントループの最大ラウンド数 | `10` |
| `AGENT_TOOL_TIMEOUT_MS` | ツール実行タイムアウト（ms） | `30000` |
| `SEARXNG_URL` | Web検索（`web_search`）の SearXNG 接続先 | `http://localhost:8888` |
| `PLANTUML_URL` | PlantUML の図を描く PlantUML サーバーの接続先 | `http://localhost:8889` |
| `LOCAL_FILE_ROOTS` | エージェントのファイルのツール（一覧・検索・読み取り）が読んでよいフォルダの絶対パス（カンマ区切り・`~` 可） | 未設定（ツールを使わない） |
| `LOCAL_FILE_WRITE_ROOTS` | エージェントのファイルの書き込み（作成・編集。実行前に承認が要る）をしてよいフォルダの絶対パス（`LOCAL_FILE_ROOTS` の中だけ・カンマ区切り・`~` 可） | 未設定（書き込みのツールを使わない） |
| `LOCAL_COMMANDS` | エージェントが実行してよいプログラムの名前（カンマ区切り。実行前に承認が要る。作業フォルダは `LOCAL_FILE_WRITE_ROOTS` の中だけ。シェル・`env`・`sudo` 等は書いても使わない） | 未設定（コマンドの実行のツールを使わない） |
| `LOCAL_COMMAND_TIMEOUT_MS` | コマンドの実行時間の上限（ms。上限 600000） | `120000` |
| `GITHUB_REPOS` | エージェントの GitHub のツールで扱ってよいリポジトリ（`owner/name` のカンマ区切り。読むツールは承認なし、コメント・PR の作成は実行前に承認が要る。認証は `gh auth login`） | 未設定（GitHub のツールを使わない） |
| `BROWSER_ENABLED` | `true` でエージェントのブラウザのツール（ページを開く・読む・スクリーンショット・クリック・入力・選択。操作は実行前に承認が要る）を使う（要 `pnpm exec playwright install chromium`） | 未設定（ブラウザのツールを使わない） |
| `BROWSER_LOCAL_ORIGINS` | ブラウザのツールで開いてよい手元の開発サーバーのオリジン（`http://localhost:5173` の形・カンマ区切り。このアプリ自身は書いても開けない） | 未設定（手元のサーバーは開けない） |

## 開発手法

- **タスク駆動開発**: `docs/07-tasks.md` のチェックリストを1つずつ消化する
- **feature branch運用**: `<種別>/<名前>`（種別: `feature` / `fix` / `chore` / `docs` / `test`）でブランチを切り、mainにマージ。種別の使い分けは `docs/04-development-rules.md` を参照
- **コミットメッセージは日本語**で記述する

## アーキテクチャ

```
ブラウザ → Next.js Route Handlers → Ollama API (localhost:11434)
                                  → Agent Loop → Tool Executor（ツール実行）→ SearXNG (Docker・Web検索)
                                                                          → gh (GitHub CLI) → GitHub（GitHub のツール）
                                                                          → Chromium（ブラウザのツール。アプリの中のプロキシで宛先を判定）
                                  → Prisma ORM → PostgreSQL + pgvector (Docker)
                                  → Ollama の埋め込み（/api/embed。RAG のドキュメントの取り込み）
                                  → git（RAG の保管庫。既定のブランチを読むだけ）・手元のノートのフォルダ（KNOWLEDGE_VAULTS）
                                  → Agent Loop → save_memory（承認の後にメモの保管庫へ書き、git なら main にコミット。KNOWLEDGE_MEMORY_VAULT）
                                  → Agent Loop → delegate_to_agent → サブエージェントのループ（リサーチャー・手元の読み手。同じモデル・読むツールだけ・まとめた回答だけを返す。#26）
                                  → PlantUML サーバー (Docker・図の描画)
```

- フロントエンドからOllamaへの直接通信はしない。Route Handlersを経由する。
- ストリーミングは `ReadableStream` を使用しリアルタイム中継。
- 状態管理はReact `useState`。グローバルstate管理ライブラリは使わない。
- 会話履歴はPostgreSQLに永続化。Conversation → Message → Attachment（user の添付画像・assistant のブラウザのツールの画面）のリレーション（カスケード削除）。プロンプトテンプレート（PromptTemplate。#28）も PostgreSQL に置く（会話とはリレーションを持たない）。応答のブックマーク（Bookmark。#30）は Message に 1 対 1 で付き、Message の削除でカスケード削除される。RAG のドキュメント（KnowledgeDocument → KnowledgeChunk。#17）は会話とリレーションを持たず、チャンクの埋め込みは pgvector の `vector` の列に置く。保管庫（#235）のファイルは `vault`（保管庫の名前）と `sourceHash`（中身の版）を持ち、名前は `保管庫の名前/パス`。会話から覚えさせたメモ（#236）は DB ではなくメモの保管庫のファイル（`memories/<名前>.md`）が正本で、書いた直後にそのファイルだけを索引へ入れる。会話ごとの参照の切り替えは `Conversation.knowledgeEnabled`、応答の出典は Message の metadata（`knowledgeSources`）に写しを持つ（#17 Phase B）。分岐した会話（#29）は `Conversation.forkedFromMessageId` で分岐元の応答を参照し、分岐元が消えると `null` になる（会話は残る）。
- パスエイリアス: `@/*` → `./src/*`（tsconfig.json）
- Prismaクライアントは `src/generated/prisma/` に生成。インポートは `@/generated/prisma/client`（`database.md` 参照）

### API エンドポイント一覧

| メソッド | パス | 用途 |
|---------|------|------|
| POST | `/api/chat` | Ollamaにメッセージ送信（NDJSON のストリーミング応答。終わりの `done` にトークン数・所要時間、model/enableTools/enableSubAgents/systemPrompt/imageIds/knowledgeEnabled指定可。knowledgeEnabled なら登録したドキュメントから今回のメッセージに近い部分を探してシステムプロンプトに入れ、出典を最初の `knowledge_sources` で送る（#17 Phase B）。エージェントの書き込みのツールは `tool_approval_request` を送って承認を待つ。enableSubAgents（エージェントモードのとき）なら調べもの・読みものをサブエージェントに任せる委譲のツールを渡し、委譲の記録を `tool_call_result` の `subAgent` で送る（#26）。ツールの呼び出しのイベントは呼び出しの ID（`callId`）を持ち、順番待ち（`queued`・`tool_call_begin`）とサブエージェントの中の手順（`sub_agent_step_*`）も送る（#26 Phase B）。systemPrompt は通常・エージェントとも先頭の system メッセージになり、後ろに現在の日時が付く。imageIds の添付画像は DB から読んで Ollama の `images` へ渡す） |
| GET | `/api/models` | Ollamaの利用可能モデル一覧取得（画像に対応したモデルの `visionModels` 付き） |
| GET | `/api/tools` | エージェントの利用可能ツール一覧取得（サブエージェントだけのツールは含めない。使えるサブエージェントの `subAgents` 付き。#26） |
| GET | `/api/conversations` | 会話一覧取得（分岐元の `forkedFrom` 付き。#29） |
| GET | `/api/conversations/search` | 会話のキーワード検索（タイトル・本文。空白区切りの AND、20 件ずつ） |
| POST | `/api/conversations` | 新規会話作成（会話の役割 `systemPrompt`・ドキュメントの参照 `knowledgeEnabled` を指定可） |
| PATCH | `/api/conversations/[id]` | 会話の役割（システムプロンプト）・ドキュメントの参照（`knowledgeEnabled`。#17 Phase B）の変更（送った項目だけ変える） |
| DELETE | `/api/conversations/[id]` | 会話削除（メッセージもカスケード削除。分岐した会話は残る） |
| POST | `/api/conversations/[id]/fork` | 応答から会話を分岐する（`messageId`。その応答までを新しい会話にコピー。役割・ドキュメントの参照は引き継ぐ。user のメッセージは 400。#29） |
| GET | `/api/conversations/[id]/messages` | 会話のメッセージ一覧取得（添付画像の情報・付いているブックマークの ID 付き。中身は含めない） |
| POST | `/api/conversations/[id]/messages` | メッセージ保存（クライアント採番の `id` を指定可。`attachments` は user の添付画像、assistant はブラウザのツールが撮った画面（#200）） |
| PUT | `/api/conversations/[id]/messages/[messageId]` | 応答の置き換え（再生成。旧応答の画面は `attachments` に入れ替え、旧応答のブックマークは消す） |
| POST | `/api/conversations/[id]/generate-title` | LLMで会話タイトル自動生成 |
| POST | `/api/diagrams/plantuml` | PlantUML のソースを PlantUML サーバーで SVG にして返す |
| GET | `/api/attachments/[id]` | 添付画像の中身を返す |
| POST | `/api/agent/approvals/[id]` | エージェントのツールの実行前の承認に、許可か拒否かを渡す（`approved`。#148 Phase A2） |
| GET | `/api/prompt-templates` | プロンプトテンプレートの一覧（ショートカットの昇順。#28） |
| POST | `/api/prompt-templates` | テンプレートの作成（100 件まで。ショートカットの重複は 409） |
| PUT | `/api/prompt-templates/[id]` | テンプレートの置き換え（名前・ショートカット・本文） |
| DELETE | `/api/prompt-templates/[id]` | テンプレートの削除 |
| POST | `/api/prompt-templates/examples` | 一覧が空のときに例の 4 件を作る（空でなければ 409） |
| GET | `/api/bookmarks` | 応答のブックマークの一覧（付けた日時の新しい順・20 件ずつ。`q` でメモ・応答の本文・会話のタイトルを AND で絞り込む。#30） |
| POST | `/api/bookmarks` | 応答にブックマークを付ける（`messageId`。user のメッセージは 400・もう付いていれば 409） |
| PATCH | `/api/bookmarks/[id]` | ブックマークのメモの書き換え（`note`。null・空白だけで消す。500 文字まで） |
| DELETE | `/api/bookmarks/[id]` | ブックマークを外す |
| GET | `/api/knowledge/documents` | RAG のドキュメントの一覧（画面から上げたものだけ。保管庫のファイルは含めない。名前の順。本文・埋め込みは含めない。今の埋め込みのモデルと、違うモデルで作ったものの `needsRebuild` 付き。#17） |
| POST | `/api/knowledge/documents` | ドキュメントの取り込み（`multipart/form-data` の `file`。`.md`・`.markdown`・`.txt`・1 MB まで。応答の中で埋め込みまで作る。同じ名前は置き換え。大きすぎれば 413） |
| DELETE | `/api/knowledge/documents/[id]` | ドキュメントの削除（チャンクもカスケードで消える） |
| POST | `/api/knowledge/documents/[id]/rebuild` | 保存した本文から、今の埋め込みのモデルでチャンクを作り直す |
| GET | `/api/knowledge/vaults` | RAG の保管庫の一覧（`KNOWLEDGE_VAULTS` の順 + 索引だけ残っているもの。読む版（git は既定のブランチとコミット）・索引の数・読めない理由。#235） |
| POST | `/api/knowledge/vaults/[name]/plan` | 保管庫の同期の差分（足す・変わった・作り直し・消えたパスと、取り込まなかった理由ごとの数。ファイルが 2,000 を超えれば 400） |
| POST | `/api/knowledge/vaults/[name]/sync` | 保管庫の 1 ファイルを同期する（`path`。サーバーが規則を当て直して読む。`imported` / `unchanged` / `removed` / `rejected`） |
| DELETE | `/api/knowledge/vaults/[name]` | 設定に無い保管庫の索引を消す（設定にある保管庫は 409） |

詳細は `docs/03-api-design.md`・`.claude/rules/api.md` を参照。

DBスキーマ詳細は `.claude/rules/database.md` を参照。

## ディレクトリ構成

### プロジェクト全体

- **`.github/workflows/`** — GitHub Actions CI定義（Quality / UT / IT / E2E の4ジョブ。ドキュメントのみの変更では発火しない。加えて Workflow Lint・Secret scan を常時実行）。アクションの版更新は `.github/dependabot.yml`（Dependabot・週次）
- **`base/`** — UIデザインリファレンス（読み取り専用。編集禁止）
- **`docs/`** — プロジェクトドキュメント（`docs/models/` は使用 LLM モデルの評価、`docs/diagrams/` は draw.io の構成図。正準は `architecture.drawio`）
- **`manuals/`** — セットアップガイド等のマニュアル
- **`front/`** — Next.jsアプリケーション本体（開発はここで行う）
- **`docker-compose.yml`** — PostgreSQL（pgvector 入り）・SearXNG（Web検索）・PlantUML（図の描画）のコンテナ定義（プロジェクトルート）
- **`searxng/`** — SearXNG の設定（`settings.yml`。JSON API の有効化・Web 検索のエンジンの追加等。`docker-compose.yml` がマウントする）

### front/src/ ソースコード構成（層 → 機能）

- **`app/`** — Next.js App Router（ページ、レイアウト、Route Handlers）
  - `api/chat/` — Ollamaストリーミング通信（model指定可）
  - `api/models/` — 利用可能モデル一覧取得
  - `api/conversations/` — 会話CRUD
  - `api/conversations/search/` — 会話のキーワード検索
  - `api/conversations/[id]/generate-title/` — LLMでタイトル自動生成
  - `api/conversations/[id]/fork/` — 応答から会話を分岐する（#29）
  - `api/diagrams/plantuml/` — PlantUML の図の描画（PlantUML サーバーへ中継）
  - `api/attachments/[id]/` — 添付画像の取得
  - `api/agent/approvals/[id]/` — ツールの実行前の承認（許可・拒否）
  - `api/prompt-templates/` — プロンプトテンプレートの CRUD（`[id]/`）・例の作成（`examples/`）
  - `api/bookmarks/` — 応答のブックマークの一覧・付ける・メモの書き換え・外す（`[id]/`）
  - `api/knowledge/documents/` — RAG のドキュメントの一覧・取り込み・削除（`[id]/`）・作り直し（`[id]/rebuild/`）（#17）
  - `api/knowledge/vaults/` — RAG の保管庫の一覧・差分（`[name]/plan/`）・1 ファイルの同期（`[name]/sync/`）・索引の削除（`[name]/`）（#235）
- **`hooks/`・`lib/`・`types/`・`constants/` の中は機能ごとのディレクトリに分ける**（`src/<層>/<機能>/`。直下にファイルを置かない。#160）
- **UI コンポーネントは Atomic Design**（#163・`docs/12-ui-components.md`）: 共通の部品は `components/common/{atoms,molecules,templates}/`、機能の部品は `components/features/<機能>/{atoms,molecules,organisms}/`。page（`app/page.tsx`）はフックを呼び、organisms を組み立てて template へ渡すだけ
- **`components/`** — UIコンポーネント（Atomic Design）
  - `common/atoms/` — Button, IconButton, ToggleChip, Switch, TextInput, TextArea, Select, Mark, StatusDot, LoadingDots
  - `common/molecules/` — Modal, SearchBox, CopyButton, CodeBlockFrame, HighlightedText
  - `common/templates/` — ChatLayout（画面の枠）
  - `features/chat/` — チャット（atoms: AttachButton, ElementBoxOverlay, KnowledgeToggle, SubAgentToggle / molecules: ToolCallIndicator, WebSearchResult, DiagramView, DiagramZoomDialog, AttachmentPreview, MessageImages, ImageZoomDialog, ApprovalCard, ToolScreenshots, ResponseMetrics, KnowledgeSources, PromptTemplateSuggestions, SubAgentRunDetails / organisms: ChatWindow, ChatBar, Header, Footer, MarkdownContent, RoleDialog, ExportDialog, ToolCallResult, AgentThinking, AgentSteps）
  - `features/sidebar/` — サイドバー（molecules: ConversationListItem, SearchResultItem / organisms: Sidebar, SidebarDrawer, SidebarContent, ConversationSearch）
  - `features/settings/` — 設定（organisms: SettingsModal）
  - `features/prompt-template/` — プロンプトテンプレート（organisms: PromptTemplateDialog）
  - `features/bookmark/` — 応答のブックマーク（molecules: BookmarkListItem / organisms: BookmarkDialog）
  - `features/shortcut/` — ショートカットキー（organisms: ShortcutHelpDialog）
  - `features/knowledge/` — RAG のドキュメント（molecules: KnowledgeDocumentItem, KnowledgeVaultItem / organisms: KnowledgeDialog。#17・#235）
- **`constants/`** — 定数（`chat/toolLabels.ts`・`chat/imageAttachment.ts`・`chat/diagram.ts`・`chat/pptx.ts`・`agent/github.ts`・`agent/browser.ts`・`agent/approval.ts`・`agent/sub-agent.ts`・`knowledge/file.ts`・`knowledge/memory.ts`・`knowledge/search-documents.ts`・`prompt-template/errors.ts`・`conversation/title.ts`・`shortcut/shortcuts.ts`・`sidebar/{list,layout}.ts`）
- **`generated/prisma/`** — Prisma自動生成クライアント
- **`hooks/`** — カスタムフック（`chat/{useChat,useModels,useImageAttachments,useMermaidDiagram,usePlantUmlDiagram,useApprovalCountdown,useConversationFork,useReportExport,useElapsedSeconds}`・`sidebar/{useConversations,useConversationSearch,useDrawerDialog,useSidebarVisibility,useListNavigation}`・`settings/useAgentSettings`・`shortcut/{useKeyboardShortcuts,useIsMac}`・`prompt-template/usePromptTemplates`・`bookmark/{useBookmarks,useMessageBookmark}`・`knowledge/{useKnowledgeDocuments,useKnowledgeAvailability,useKnowledgeVaults}`・`theme/useTheme`・`clipboard/useCopyFeedback`）
- **`lib/`** — ユーティリティ・外部連携
  - `lib/agent/` — エージェント（agent.ts, agent-config.ts, agent-prompts.ts, approvals.ts。サブエージェント（#26）は sub-agents.ts（定義・使えるものの判定・委譲の結果）と sub-agent-loop.ts（本文を集めるループ。ツールの実行は agent.ts の executeToolCall を共有））
    - `lib/agent/tools/` — ツール実装（types.ts, index.ts, output.ts, registry.ts, get-current-datetime.ts, calculate.ts, web-search.ts, url-fetch.ts, read-body.ts）
      - `lib/agent/tools/local-files/` — ローカルのファイルのツール（config.ts, path-guard.ts, text.ts, list-directory.ts, search-files.ts, read-file.ts。`LOCAL_FILE_ROOTS` があるときだけ登録。#148。書き込みは write-guard.ts, diff.ts, write-file.ts, edit-file.ts。`LOCAL_FILE_WRITE_ROOTS` があるときだけ登録・実行前に承認。#148 Phase A2）
      - `lib/agent/tools/local-commands/` — コマンドの実行のツール（config.ts, parse.ts, resolve.ts, process.ts, run-command.ts。`LOCAL_COMMANDS` と `LOCAL_FILE_WRITE_ROOTS` があるときだけ登録・実行前に承認・シェルを介さない。#148 Phase B）
      - `lib/agent/tools/github/` — GitHub のツール（config.ts, args.ts, gh.ts, format.ts, list.ts, view.ts, pr-diff.ts, comment.ts, create-pr.ts。`GITHUB_REPOS` があるときだけ登録・`gh` の引数はアプリが組み立てる・コメントと PR の作成は実行前に承認。#148 Phase C）
      - `lib/agent/tools/browser/` — ブラウザのツール（config.ts, url-policy.ts, proxy.ts, browser.ts, session.ts, snapshot.ts, navigate.ts, read-snapshot.ts, screenshot.ts。操作は element.ts, action.ts, click.ts, type.ts, select.ts で、実行前に承認・同じ応答の中では順に実行（`exclusive`）。#149 Phase C。利用者へ見せる画面（操作の前・後、開いた後）は capture.ts で撮り、応答の保存で assistant の添付画像にする。#200。`BROWSER_ENABLED=true` のときだけ登録・応答ごとのセッション・通信はアプリの中のプロキシで宛先を判定・手元の開発サーバーは `BROWSER_LOCAL_ORIGINS` だけ。#149。プライベートのアドレスの判定は `tools/network-guard.ts` で `url-fetch.ts` と共有）
      - `lib/agent/tools/sub-agent/` — 調べもの・読みものをサブエージェントに任せるツール（delegate.ts の `delegate_to_agent`。使えるサブエージェントがあれば登録し、モデルへ渡すのは設定の「サブエージェントに任せる」のときだけ・1 つずつ実行・1 応答 4 回まで・サブエージェントは 150 秒でまとめ始め 300 秒で止める。#26）
      - `lib/agent/tools/knowledge/` — 登録したドキュメントを探すツール（search-documents.ts の `search_documents`。サブエージェントの手元の読み手だけが使う（`subAgentOnly`）。#26）
      - `lib/agent/tools/memory/` — 会話から覚えさせたことを書くツール（save-memory.ts。`KNOWLEDGE_MEMORY_VAULT` が `KNOWLEDGE_VAULTS` の保管庫のときだけ登録・実行前に承認・`memories/<名前>.md` に書き、git なら main にコミットして索引に入れる。#236）
  - `lib/llm/` — LLM との通信（ollama.ts（埋め込みの `embed` も。#17）, current-date.ts, metrics.ts）
  - `lib/chat/` — チャット（tool-label.ts（ツールの見出しの名前・引数の要約。#26）, chat-state.ts, conversation-history.ts, message-metadata.ts, regenerate.ts, agent-timeline.ts, tool-call-progress.ts, tool-screenshots.ts, approval-countdown.ts, response-metrics.ts, system-prompt.ts, code-block.ts, diagram.ts, image-attachment.ts, export.ts, report-html.ts, report-style.ts, document-model.ts, report-docx.ts, pptx-layout.ts, report-pptx.ts, report-assets.ts, slides.ts, report-slides.ts, slides-style.ts）
  - `lib/conversation/` — 会話（search.ts, fork.ts）
  - `lib/prompt-template/` — プロンプトテンプレート（suggest.ts）
  - `lib/bookmark/` — ブックマーク（snippet.ts）
  - `lib/knowledge/` — RAG のドキュメント（file.ts: ファイルの検証、chunk.ts: チャンクの分け方、embedding-text.ts: 埋め込みへ渡す文。#17。prompt.ts: 見つかったチャンク → システムプロンプトの節・出典。#17 Phase B。vault.ts: 保管庫の取り込まない規則・パスの検証・差分の計算。#235。memory.ts: 覚えさせるメモの検証・frontmatter・鍵らしい文字列の判定。#236）
  - `lib/shortcut/` — ショートカットキー（match.ts）
  - `lib/sidebar/` — サイドバー（visibility.ts, list-navigation.ts）
  - `lib/server/` — サーバー専用（prisma.ts, prisma-error.ts, request-body.ts, conversation.ts, plantuml.ts, attachment.ts, chat-images.ts, knowledge.ts（ドキュメントの DB の処理・raw SQL）, knowledge-response.ts, knowledge-vault-config.ts（`KNOWLEDGE_VAULTS`・検索で比べる範囲）, knowledge-vault.ts（保管庫の列挙（git / フォルダ）・同期）, knowledge-memory.ts（メモの書き込み・main へのコミット・索引への反映。#236））
  - `lib/shared/` — サーバー・クライアント共通（validation.ts, class-names.ts, clipboard.ts, download.ts, print.ts, image.ts）
- **`types/`** — 機能をまたぐ共通型（agent/tool-call.ts: ToolCallInfo/SubAgentRun、agent/sub-agent.ts: SUB_AGENT_NAMES/SubAgentName、chat/message.ts: Message/MessageImage/HistoryEntry、chat/attachment.ts: PreparedImage、chat/agent-timeline.ts: AgentTimeline/AgentTimelineStep、chat/metrics.ts: ResponseMetrics、chat/diagram.ts: DiagramKind/DiagramState、conversation/conversation.ts: Conversation/ConversationForkSource/ConversationSearchResult、prompt-template/prompt-template.ts: PromptTemplate、bookmark/bookmark.ts: Bookmark/BookmarkListItem、shortcut/shortcut.ts: ShortcutId/ShortcutDefinition、knowledge/document.ts: KnowledgeDocumentItem/KnowledgeHit/KnowledgeSource、knowledge/vault.ts: KnowledgeVaultItem/VaultSyncPlan/VaultSyncProgress、knowledge/memory.ts: MEMORY_TYPES/MemoryInput、theme/theme.ts: THEMES/ThemeId）

### デザインリファレンス（base/ — 読み取り専用）

`base/themes.ts`（配色）・`base/App.tsx`（全体レイアウト）・`base/types.ts`（型定義）・`base/components/`（実装参考）

## テスト方針

- **3層構成**: ユニット（Vitest / 純ロジック）+ インテグレーション（Vitest + Testcontainers / 実DB）+ E2E（Playwright / 実環境）。UIコンポーネント単位のUTは不要。
- **UT**: 外部I/O非依存の純ロジックを対象。外部I/Oのみモック・ビジネスロジックはモックしない。配置: `front/tests/unit/`
- **IT**: route handler をブラウザ抜きで実PostgreSQL（Testcontainers）相手に検証。実依存（DB）は使い、mockは真の外部（Ollama/Web）のみ。配置: `front/tests/integration/`
- **E2Eテスト必須**（Playwright）。実際のOllama + PostgreSQLに接続。配置: `front/tests/e2e/`
- **pgvector のイメージ**: `docker-compose.yml`・CI の E2E（`services.postgres`）・IT（Testcontainers）で同じ `pgvector/pgvector:0.8.6-pg16-trixie` を使う（#17）
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
| `docs/13-image-attachment.md` | 画像添付（マルチモーダル） 設計書 |
| `docs/14-local-file-tools.md` | ローカルファイルの検索・読み取りツール 設計書 |
| `docs/15-tool-approval.md` | ツールの承認とファイルの書き込み 設計書 |
| `docs/16-command-execution.md` | コマンドの実行 設計書 |
| `docs/17-github-tools.md` | GitHub のツール 設計書 |
| `docs/18-browser-tools.md` | ブラウザのツール 設計書 |
| `docs/19-token-metrics.md` | トークン数・生成速度の表示 設計書 |
| `docs/20-prompt-templates.md` | プロンプトテンプレート 設計書 |
| `docs/21-bookmarks.md` | 応答のブックマーク 設計書 |
| `docs/22-conversation-fork.md` | 会話の分岐 設計書 |
| `docs/23-keyboard-shortcuts.md` | ショートカットキー 設計書 |
| `docs/24-html-report-export.md` | HTML レポートと PDF の書き出し 設計書 |
| `docs/25-docx-export.md` | DOCX の書き出し 設計書 |
| `docs/26-html-slides-export.md` | HTML スライドの書き出し 設計書 |
| `docs/27-pptx-export.md` | PPTX の書き出し 設計書 |
| `docs/28-rag.md` | RAG（手元のドキュメントで答える） 設計書 |
| `docs/29-multi-agent.md` | マルチエージェント（サブエージェントに任せる） 設計書 |
| `docs/models/` | LLM モデル評価（`README.md` に比較、モデルごとに 1 ファイル） |
| `manuals/setup-guide-macos.md` | macOS向けセットアップガイド |

新規ドキュメント追加時は次の連番（`30-`〜）を付与する。

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
| `coding-standards.md` | 全体 | TypeScript strict / pnpm（推移的な依存の脆弱性は `pnpm.overrides`）/ ESLint+Prettier / シークレット禁止 |
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
