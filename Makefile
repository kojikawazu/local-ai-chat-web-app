# Nordic Chat — 開発タスクショートカット
#
# ルート（docker compose）と front/（pnpm）にまたがるコマンドをまとめる。
# 使い方: `make` でターゲット一覧を表示。各ターゲットは `make <target>` で実行。

FRONT := front

.DEFAULT_GOAL := help

.PHONY: help setup install dev build lint format \
        test test-unit test-integration test-e2e \
        db-up db-down db-migrate db-generate db-studio

help: ## このヘルプを表示
	@echo "Nordic Chat — 利用可能なターゲット:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

## --- セットアップ ---

setup: db-up install db-generate db-migrate ## 初期セットアップ（DB起動→依存導入→Prisma生成→マイグレーション）

install: ## 依存パッケージをインストール
	cd $(FRONT) && pnpm install

## --- 開発 ---

dev: ## 開発サーバー起動（http://localhost:3000）
	cd $(FRONT) && pnpm dev

build: ## プロダクションビルド
	cd $(FRONT) && pnpm build

lint: ## ESLint チェック
	cd $(FRONT) && pnpm lint

format: ## Prettier フォーマット
	cd $(FRONT) && pnpm format

## --- テスト ---

test: test-unit test-integration ## UT + IT を実行（Ollama不要・E2Eは含まない）

test-unit: ## ユニットテスト（Vitest）
	cd $(FRONT) && pnpm test:unit

test-integration: ## インテグレーションテスト（Vitest + Testcontainers・Docker必須）
	cd $(FRONT) && pnpm test:integration

test-e2e: ## E2Eテスト（Playwright・Ollama + PostgreSQL必須）
	cd $(FRONT) && pnpm test:e2e

## --- DB（PostgreSQL / Prisma） ---

db-up: ## PostgreSQL コンテナ起動
	docker compose up -d

db-down: ## PostgreSQL コンテナ停止
	docker compose down

db-migrate: ## マイグレーション実行（開発）
	cd $(FRONT) && pnpm prisma migrate dev

db-generate: ## Prisma クライアント再生成
	cd $(FRONT) && pnpm prisma generate

db-studio: ## Prisma Studio 起動（DBブラウザ）
	cd $(FRONT) && pnpm prisma studio
