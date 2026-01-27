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
| LLM | Ollama — デフォルト `qwen3-coder:latest`（動的にモデル切替可能） |
| DB | PostgreSQL 16（Docker Compose） |
| ORM | Prisma 7（クライアント出力先: `src/generated/prisma/`） |
| E2Eテスト | Playwright |
| リンター | ESLint 9 + eslint-config-prettier |
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
| `OLLAMA_MODEL` | 使用モデル | `qwen3-coder:latest` |
| `DATABASE_URL` | PostgreSQL接続文字列 | `postgresql://postgres:postgres@localhost:5432/chat_db` |

## 開発手法

- **タスク駆動開発**: `docs/07-tasks.md` のチェックリストを1つずつ消化する
- **feature branch運用**: `feature/<機能名>` でブランチを切り、mainにマージ
- **コミットメッセージは日本語**で記述する

## アーキテクチャ

```
ブラウザ → Next.js Route Handlers → Ollama API (localhost:11434)
                                  → Prisma ORM → PostgreSQL (Docker)
```

- フロントエンドからOllamaへの直接通信はしない。Route Handlersを経由する。
- ストリーミングは `ReadableStream` を使用しリアルタイム中継。
- 状態管理はReact `useState`。グローバルstate管理ライブラリは使わない。
- 会話履歴はPostgreSQLに永続化。Conversation → Message のリレーション（カスケード削除）。
- パスエイリアス: `@/*` → `./src/*`（tsconfig.json）
- Prismaクライアントは `src/generated/prisma/` に生成される（標準の`node_modules`ではない）。`import { PrismaClient } from '@/generated/prisma'` でインポート。

### データフロー: チャット送信

1. ユーザーが`ChatBar`でメッセージ入力・送信
2. `page.tsx`がユーザーメッセージをstateに追加
3. `/api/conversations/[id]/messages` にユーザーメッセージをDB保存
4. `/api/chat` にPOST（会話履歴付き）
5. Route HandlerがOllama APIにストリーミングリクエスト送信
6. Ollamaからのストリーミングレスポンス（NDJSON形式）をクライアントに中継
7. フロントエンドがReadableStreamを読み取り、リアルタイムにUIを更新
8. ストリーミング完了後、AIメッセージをDBに保存

### Ollamaストリーミングプロトコル

OllamaはNDJSON（改行区切りJSON）でストリーミングレスポンスを返す:

```json
{"model":"qwen3-coder:latest","message":{"role":"assistant","content":"Hello"},"done":false}
{"model":"qwen3-coder:latest","message":{"role":"assistant","content":"!"},"done":false}
{"model":"qwen3-coder:latest","message":{"role":"assistant","content":""},"done":true}
```

`done: true` でストリーミング完了。

### API エンドポイント一覧

| メソッド | パス | 用途 |
|---------|------|------|
| POST | `/api/chat` | Ollamaにメッセージ送信（ストリーミング応答、model指定可） |
| GET | `/api/models` | Ollamaの利用可能モデル一覧取得 |
| GET | `/api/conversations` | 会話一覧取得 |
| POST | `/api/conversations` | 新規会話作成 |
| DELETE | `/api/conversations/[id]` | 会話削除（メッセージもカスケード削除） |
| GET | `/api/conversations/[id]/messages` | 会話のメッセージ一覧取得 |
| POST | `/api/conversations/[id]/messages` | メッセージ保存 |
| POST | `/api/conversations/[id]/generate-title` | LLMで会話タイトル自動生成 |

詳細は `docs/03-api-design.md` を参照。

### DBスキーマ

```prisma
model Conversation {
  id        String    @id @default(uuid())
  title     String
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  messages  Message[]
}

model Message {
  id             String       @id @default(uuid())
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  role           String       // 'user' | 'assistant'
  content        String
  createdAt      DateTime     @default(now())
}
```

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
  - `features/chat/` — チャット機能（ChatWindow, ChatBar, Header, Footer, MarkdownContent, useChat）
  - `features/sidebar/` — サイドバー機能（Sidebar, useConversations）
- **`generated/prisma/`** — Prisma自動生成クライアント
- **`hooks/`** — 共通カスタムフック（useTheme等）
- **`lib/`** — ユーティリティ（ollama.ts, prisma.ts, validation.ts）
- **`types/`** — 共通型定義

### デザインリファレンス（base/ — 読み取り専用）

| ファイル | 役割 |
|---------|------|
| `base/themes.ts` | Nordic Frost配色定義（`#2e3440`, `#88c0d0`, `#eceff4` 等） |
| `base/App.tsx` | 全体レイアウト（Sidebar / Header / ChatWindow / ChatBar / Footer） |
| `base/types.ts` | Message型、ThemeStyles型 |
| `base/components/` | 各コンポーネントの実装参考 |

## テスト方針

- **E2Eテスト必須**（Playwright）。コンポーネント単位のユニットテストは不要。
- **全テストファイルに正常系・準正常系・異常系の3分類を必ず含めること**
- テストコード内で `describe('正常系')`, `describe('準正常系')`, `describe('異常系')` に分割する
- **実環境テスト**: 実際のOllama + PostgreSQLに接続してテスト実行
- **ブラウザ**: Chromiumのみ
- **ストリーミングテスト**: 応答内容まで検証する（空でないこと、特定パターン確認）
- **スクリーンショットテスト**: 可能な画面でビジュアルリグレッションを実施
- **失敗時レポート**: スクリーンショット + Playwrightトレースを保存
- **テストデータ管理**: テストスイート（ファイル）単位でセットアップ/クリーンアップ
- **CI**: GitHub Actions（push/PR to main）で自動実行
  - CIモデル: `qwen2.5:0.5b`（思考モードなし、CPU only対応）
  - ストリーミング完了テスト・スクリーンショットテスト・デバッグテストはCIスキップ
  - 詳細は `docs/08-ci-e2e-bug-report.md` を参照
- テストファイル配置: `front/tests/e2e/`
- **Playwright設定**: workers: 1（順次実行）、retry: 1、webServerで`pnpm dev`を自動起動
- 詳細は `docs/06-testing.md` を参照

## テーマシステム

CSS変数ベースの3テーマ切替（Nordic Frost / Aurora Borealis / Midnight Ocean）。

- `globals.css` の `@theme` ディレクティブでCSS変数を定義（**`@theme inline` は使用禁止** — 値がインラインされてテーマ切替が機能しない）
- `[data-theme='aurora']`, `[data-theme='ocean']` セレクタで変数を上書き
- `useTheme` フック（`useState` + `useEffect`）で状態管理とDOM反映
- React Compiler環境ではレンダリング中の副作用が最適化で除去されるため、DOM操作は必ず `useEffect` 内で行う

## セキュリティ方針

- **認証不要**（localhost個人利用）
- **入力バリデーション厳格**: メッセージ最大10,000文字、空入力禁止、フロントエンド + API両方でチェック
- **XSS対策**: `dangerouslySetInnerHTML` 使用禁止。Reactの標準エスケープを活用。Markdown表示は `react-markdown` を使用（HTMLパースなし）
- **CSPヘッダー**を `next.config.ts` で設定する
- **エラー情報**: 詳細をクライアントに返す（ローカル利用のため）
- 詳細は `docs/05-security.md` を参照

## ドキュメント一覧

| ファイル | 内容 |
|---------|------|
| `docs/01-requirements.md` | 要件定義 |
| `docs/02-architecture.md` | アーキテクチャ設計 |
| `docs/03-api-design.md` | API設計 |
| `docs/04-development-rules.md` | 開発ルール詳細 |
| `docs/05-security.md` | セキュリティ要件 |
| `docs/06-testing.md` | テスト要件 |
| `docs/07-tasks.md` | タスク一覧・進捗管理 |
| `docs/08-ci-e2e-bug-report.md` | CI E2Eテスト バグレポート |
| `manuals/setup-guide-macos.md` | macOS向けセットアップガイド |

新規ドキュメント追加時は次の連番（`09-`〜）を付与する。
