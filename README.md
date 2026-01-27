# Nordic Chat — ローカルAIチャットWebアプリ

[![E2E Tests](https://github.com/kojikawazu/local-ai-chat-web-app/actions/workflows/e2e-test.yml/badge.svg)](https://github.com/kojikawazu/local-ai-chat-web-app/actions/workflows/e2e-test.yml)

ローカルLLM（Ollama）と対話するチャットWebアプリケーション。
Nordic Frostデザインシステムをベースとした、プライベートなAIワークスペース。

## 主な機能

- **リアルタイムストリーミング**: Ollamaからの応答を1文字ずつリアルタイム表示
- **会話管理**: 会話の作成・切り替え・削除、PostgreSQLへの永続化
- **会話タイトル自動生成**: 最初のメッセージからLLMがタイトルを自動生成
- **モデル選択**: Ollamaにインストール済みのモデルを動的に切り替え
- **マークダウン表示**: AIレスポンスのコードブロック・テーブル・リスト等を整形表示
- **テーマ切替**: Nordic Frost / Aurora Borealis / Midnight Ocean の3テーマ
- **IME対応**: 日本語入力中のEnter確定で誤送信されない
- **レスポンシブデザイン**: デスクトップ・モバイル対応

## 技術スタック

| 項目 | 技術 |
|------|------|
| フレームワーク | Next.js 16 (App Router) + TypeScript 5 |
| React | React 19（React Compiler有効） |
| スタイリング | TailwindCSS 4 |
| Markdown | react-markdown + remark-gfm |
| LLM | Ollama（ローカル実行） |
| DB | PostgreSQL 16（Docker Compose） |
| ORM | Prisma 7 |
| テスト | Playwright（E2E） |

## セットアップ

> 詳細な手順は [macOS向けセットアップガイド](manuals/setup-guide-macos.md) を参照してください。

### 前提条件

- Node.js 20+
- pnpm
- Docker + Docker Compose
- [Ollama](https://ollama.ai/)（ローカルにインストール済み）

### 1. Ollamaのセットアップ

```bash
# Ollamaをインストール後、モデルをダウンロード
ollama pull qwen3-coder:latest
```

### 2. PostgreSQLの起動

```bash
# プロジェクトルートで実行
docker compose up -d
```

### 3. アプリケーションのセットアップ

```bash
cd front
pnpm install
pnpm prisma migrate dev    # DBマイグレーション
pnpm dev                   # 開発サーバー起動
```

### 4. 環境変数（任意）

`front/.env.local` にカスタム設定が可能:

```env
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3-coder:latest
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/chat_db
```

## コマンド一覧

```bash
cd front
pnpm dev             # 開発サーバー起動
pnpm build           # プロダクションビルド
pnpm lint            # ESLintチェック
pnpm format          # Prettierフォーマット
pnpm test:e2e        # E2Eテスト実行
pnpm prisma studio   # DBブラウザ起動
```

## アーキテクチャ

```
ブラウザ → Next.js Route Handlers → Ollama API (localhost:11434)
                                  → Prisma ORM → PostgreSQL (Docker)
```

- フロントエンドからOllamaへの直接通信はしない（Route Handlers経由）
- ストリーミングは `ReadableStream` でリアルタイム中継
- CSS変数ベースのテーマシステム（`data-theme`属性で切替）

## ドキュメント

| ファイル | 内容 |
|---------|------|
| `docs/01-requirements.md` | 要件定義 |
| `docs/02-architecture.md` | アーキテクチャ設計 |
| `docs/03-api-design.md` | API設計 |
| `docs/04-development-rules.md` | 開発ルール |
| `docs/05-security.md` | セキュリティ要件 |
| `docs/06-testing.md` | テスト要件 |
| `docs/07-tasks.md` | タスク一覧・進捗管理 |
| `docs/08-ci-e2e-bug-report.md` | CI E2Eテスト バグレポート |
| `manuals/setup-guide-macos.md` | macOS向けセットアップガイド |

## CI

GitHub Actions で E2E テストを自動実行（push / PR to main）。

- **環境**: Ubuntu + PostgreSQL + Ollama (`qwen2.5:0.5b`) + Chromium
- **テスト結果**: Artifact として playwright-report をアップロード
- **制限事項**: CPU only のためストリーミング完了テスト等はCIスキップ（[詳細](docs/08-ci-e2e-bug-report.md)）

## ライセンス

Private
