---
description: ドキュメント更新・設計書管理ルール（影響マップ + opt-out の完了条件）
globs: 
---

# ドキュメント

コード変更がドキュメント（CLAUDE.md / README.md / docs/）と乖離しないことを構造的に担保する。

## 完了条件（opt-out）

変更は、下記「影響マップ」の対応ドキュメントを**同一 PR 内で更新する**ことを完了条件とする。

- 更新不要と判断した場合は、**PR 説明にその理由を明記する**（省略＝未対応とみなす）。
- この乖離チェックは `/self-review` と `/pr-create` の確認対象に含まれる。

## 影響マップ（変更種別 → 更新必須ドキュメント）

「どのドキュメントだっけ？」を考えさせないための逆引き表。

| 変更種別 | 更新必須ドキュメント |
|---|---|
| タスクの追加・着手・完了 | `docs/07-tasks.md` |
| 要件の変更・追加 | `docs/01-requirements.md` |
| アーキテクチャ・データフローの変更 | `docs/02-architecture.md`、`CLAUDE.md`（アーキテクチャ / ディレクトリ構成節） |
| API エンドポイントの追加・変更・削除 | `docs/03-api-design.md`、`.claude/rules/api.md`、`CLAUDE.md`（API エンドポイント一覧） |
| 開発ルール・指示ルールの変更 | `docs/04-development-rules.md`、`CLAUDE.md`、該当する `.claude/rules/*.md` |
| セキュリティ要件の変更 | `docs/05-security.md`、`.claude/rules/security.md` |
| テスト方針・テスト構成の変更 | `docs/06-testing.md`、`.claude/rules/testing.md` |
| CI / E2E の変更・バグ記録 | `docs/08-ci-e2e-bug-report.md`、`.github/workflows/` |
| エージェント機能・ツールの変更 | `docs/09-agent-architecture.md` |
| ロードマップ・今後の方針の変更 | `docs/10-roadmap.md` |
| 技術スタック・コマンド・環境変数の変更 | `CLAUDE.md`（技術スタック / コマンド / 環境変数節）、`README.md` |
| DB スキーマ・Prisma 構成の変更 | `.claude/rules/database.md`、`CLAUDE.md`（必要に応じて） |
| セットアップ手順の変更 | `manuals/setup-guide-macos.md`、`README.md` |
| 新規ドキュメントの追加 | `docs/`（次の連番 `11-`〜を付与）、`CLAUDE.md`（ドキュメント一覧、`docs/README.md` 索引） |

該当する変更がない場合はスキップする。

## 重複している事実（変更時は全箇所を更新）

同じ事実が複数ファイルに転記されているため、1箇所だけ直すと乖離する。**変更時は下表の全箇所を必ず更新**し、可能なら転記元（コード）を正準とする。

| 事実 | 正準（source of truth） | 転記されている箇所（要同期） |
|---|---|---|
| デフォルトLLMモデル名 | `front/src/lib/ollama.ts`（`OLLAMA_DEFAULT_MODEL`） | `CLAUDE.md`、`README.md`、`README.en.md`、`docs/01`、`docs/02`、`docs/03`、`front/.env.example`、`manuals/setup-guide-macos.md`（※ `docs/07`・`docs/08` の履歴記述は除く） |
| E2E テストファイル一覧 | `front/tests/e2e/*.spec.ts`（実体） | `docs/02`、`docs/04`、`docs/06` の3箇所のツリー |
| API エンドポイント一覧 | `front/src/app/api/**/route.ts`（実体） | `CLAUDE.md`、`docs/03`、`.claude/rules/api.md` |
| 環境変数一覧 | `front/.env.example` | `CLAUDE.md`、`README.md`、`README.en.md`、`docs/02`、`manuals/setup-guide-macos.md` |
| セットアップ手順 | `manuals/setup-guide-macos.md`（詳細の正準） | `README.md`/`README.en.md` は QuickStart（要約）に留め、詳細は重複させない |
| `front/src/` ディレクトリ構成 | 実体 | `CLAUDE.md`、`docs/02` |

各 `docs/` ファイル冒頭には `> 最終更新: YYYY-MM-DD` を記載し、変更時に更新する。
