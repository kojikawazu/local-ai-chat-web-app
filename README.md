# Nordic Chat — ローカルAIチャットWebアプリ

[![Unit Tests](https://github.com/kojikawazu/local-ai-chat-web-app/actions/workflows/unit-test.yml/badge.svg)](https://github.com/kojikawazu/local-ai-chat-web-app/actions/workflows/unit-test.yml)
[![Integration Tests](https://github.com/kojikawazu/local-ai-chat-web-app/actions/workflows/integration-test.yml/badge.svg)](https://github.com/kojikawazu/local-ai-chat-web-app/actions/workflows/integration-test.yml)
[![E2E Tests](https://github.com/kojikawazu/local-ai-chat-web-app/actions/workflows/e2e-test.yml/badge.svg)](https://github.com/kojikawazu/local-ai-chat-web-app/actions/workflows/e2e-test.yml)

[English](README.en.md) ・ 最終更新: 2026-07-11

ローカルLLM（Ollama）と対話するチャットWebアプリケーション。
Nordic Frostデザインシステムをベースとした、プライベートなAIワークスペース。

会話データを外部クラウドに送らず、**すべて手元のマシン（Ollama + PostgreSQL）で完結**させたい人向けのチャットUIです。ChatGPTライクな操作感で、ローカルLLMの会話履歴管理・モデル切替・ツール呼び出し（エージェント）までを1つのWebアプリにまとめています。

**想定ユーザー**: プライバシー重視でローカル完結したい個人 / ローカルLLMを手軽なUIで試したい開発者 / Next.js + Ollama + Prisma の実装例を探している人。

## スクリーンショット

<!-- 画像を docs/images/ に配置後、以下のコメントアウトを解除してください -->
<!--
| チャット画面 | エージェント実行 | テーマ切替 |
|---|---|---|
| ![チャット画面](docs/images/chat.png) | ![エージェント実行](docs/images/agent.png) | ![テーマ切替](docs/images/themes.png) |
-->

> 📷 スクリーンショットは準備中です。Playwright のスクリーンショットテスト（`front/tests/e2e/screenshot.spec.ts`）で生成できます。

## 主な機能

- **リアルタイムストリーミング**: Ollamaからの応答を1文字ずつリアルタイム表示
- **会話管理**: 会話の作成・切り替え・削除、PostgreSQLへの永続化
- **会話タイトル自動生成**: 最初のメッセージからLLMがタイトルを自動生成
- **モデル選択**: Ollamaにインストール済みのモデルを動的に切り替え
- **マークダウン表示**: AIレスポンスのコードブロック・テーブル・リスト等を整形表示
- **エージェント機能**: ツール呼び出し（日時取得・計算・Web検索・URL取得）と思考過程の可視化、システムプロンプトプリセット
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
| テスト | Vitest（UT）+ Testcontainers（IT）+ Playwright（E2E） |

## クイックスタート

> 詳細手順・トラブルシューティングは [macOS向けセットアップガイド](manuals/setup-guide-macos.md) を参照（手順はmacOS向けのみ。Windows/Linux は未提供）。

**前提**: Node.js 20+ ／ pnpm ／ Docker + Docker Compose ／ [Ollama](https://ollama.ai/)（インストール済み）

```bash
# 1. LLMモデルを取得（軽量モデル推奨。大型のデフォルトは約48GB）
ollama pull gemma3:4b

# 2. PostgreSQL を起動（プロジェクトルートで）
docker compose up -d

# 3. アプリのセットアップ（front/ 内で実行）
cd front
cp .env.example .env.local        # 必要に応じて OLLAMA_MODEL を編集
pnpm install
pnpm prisma migrate dev           # DBマイグレーション
pnpm dev                          # → http://localhost:3000
```

## 環境変数

`front/.env.local`（`front/.env.example` をコピーして作成）で設定:

| 変数名 | 説明 | デフォルト |
|--------|------|-----------|
| `OLLAMA_BASE_URL` | Ollama API接続先 | `http://localhost:11434` |
| `OLLAMA_MODEL` | 使用モデル（**実際に pull したモデル名に合わせる**） | `qwen3-coder-next:latest` |
| `DATABASE_URL` | PostgreSQL接続文字列 | `postgresql://postgres:postgres@localhost:5499/chat_db` |
| `AGENT_MAX_TOOL_ROUNDS` | エージェントの最大ツール呼び出しラウンド数 | `10` |
| `AGENT_TOOL_TIMEOUT_MS` | ツール実行タイムアウト（ms） | `30000` |

## コマンド一覧

```bash
cd front
pnpm dev             # 開発サーバー起動
pnpm build           # プロダクションビルド
pnpm lint            # ESLintチェック
pnpm format          # Prettierフォーマット
pnpm test:unit       # ユニットテスト実行（Vitest）
pnpm test:integration # インテグレーションテスト（Vitest + Testcontainers・Docker必須）
pnpm test:e2e        # E2Eテスト実行（Playwright）
pnpm prisma studio   # DBブラウザ起動
```

## アーキテクチャ

```
ブラウザ → Next.js Route Handlers → Ollama API (localhost:11434)
                                  → Agent Loop → Tool Executor（日時/計算/Web検索/URL取得）
                                  → Prisma ORM → PostgreSQL (Docker)
```

- フロントエンドからOllamaへの直接通信はしない（Route Handlers経由）
- ストリーミングは `ReadableStream` でリアルタイム中継（通常モードは text、エージェントモードは NDJSON イベント）
- エージェントモードは Route Handler 内のループでツールを実行し、結果を LLM に再投入
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
| `docs/09-agent-architecture.md` | エージェント機能 設計書 |
| `docs/10-roadmap.md` | 開発ロードマップ |
| `manuals/setup-guide-macos.md` | macOS向けセットアップガイド |

## CI

GitHub Actions で自動実行（push / PR to main）。UT と E2E は独立ジョブ。

- **Unit Tests**（`unit-test.yml`）: Vitest。Ollama / DB 不要で数十秒。
- **Integration Tests**（`integration-test.yml`）: Vitest + Testcontainers。使い捨て PostgreSQL を起動し route handler を実 DB で検証（Ollama 不要）。
- **E2E Tests**（`e2e-test.yml`）: Ubuntu + PostgreSQL + Ollama (`qwen2.5:0.5b`) + Chromium。
- **テスト結果**: Artifact として playwright-report をアップロード
- **制限事項**: CPU only のためストリーミング完了テスト等はCIスキップ（[詳細](docs/08-ci-e2e-bug-report.md)）

## ライセンス

本リポジトリは個人開発プロジェクトであり、再配布・商用利用を想定した OSS ライセンスは現状付与していません（**All Rights Reserved**）。コードの参照・学習目的での閲覧は歓迎します。利用に関する要望があれば作者までご連絡ください。
