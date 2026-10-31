# ドキュメント索引

> 最終更新: 2026-10-31

ローカルAIチャットWebアプリ（Nordic Chat）の仕様・設計ドキュメント一覧。プロジェクト概要はリポジトリ直下の [`../README.md`](../README.md) を参照。

ドキュメントは連番（`01`〜`25`）で管理し、**種別ごと**に下記の3グループへ分類している。新規追加時は次の連番を付与し、本索引の該当グループにも追記する。各ファイル冒頭には「最終更新」を記載する。

## 読み進め順（おすすめ）

`01 要件 → 02 アーキテクチャ → 12 UI コンポーネント → 03 API → 09 エージェント → 11 ハイライト・図表 → 13 画像添付 → 05 セキュリティ → 06 テスト → 07 タスク → 10 ロードマップ`。
04・08 は随時参照。初めて環境構築する場合は [`../manuals/setup-guide-macos.md`](../manuals/setup-guide-macos.md) のセットアップ手順から。

## 仕様・設計（正準）

実装が従うべき正準ドキュメント。

| # | ドキュメント | 概要 |
|---|---|---|
| 01 | [要件定義書](./01-requirements.md) | 技術スタック・機能要件（MVP/追加）・非機能要件・セキュリティ要件 |
| 02 | [アーキテクチャ設計書](./02-architecture.md) | システム構成・ディレクトリ構成・データフロー・テーマシステム |
| 03 | [API 設計書](./03-api-design.md) | Route Handlers・Ollama 連携・リクエスト/レスポンス・ステータスコード |
| 04 | [開発ルール](./04-development-rules.md) | 開発フロー・コミット規約・ブランチ運用・テスト方針 |
| 05 | [セキュリティ要件](./05-security.md) | 認証方針・XSS/インジェクション対策・CSP・シークレット管理 |
| 06 | [テスト要件](./06-testing.md) | Playwright E2E 戦略・3分類・テスト構成・CI |
| 09 | [エージェント機能 設計書](./09-agent-architecture.md) | ツール呼び出し基盤・調査系ツール・自律エージェント（Phase A/B/C） |
| 11 | [シンタックスハイライト・図表レンダリング 設計書](./11-syntax-highlight-diagrams.md) | コードブロックの言語別の色付け・言語名ラベル（20-1）、Mermaid / PlantUML（未着手） |
| 12 | [UI コンポーネント 設計書](./12-ui-components.md) | Atomic Design の階層・置き場所・依存の向き・atoms / molecules の props・移行の段階（#163） |
| 13 | [画像添付 設計書](./13-image-attachment.md) | 画像の添付・前処理・保存（`Attachment`）・LLM へ渡す画像の選び方・非対応モデルの扱い（#6） |
| 14 | [ローカルファイルのツール 設計書](./14-local-file-tools.md) | ファイルの一覧・検索・読み取りのツール、許可するフォルダ・秘匿ファイル・外部への持ち出しの抑止（#148 Phase A） |
| 15 | [ツールの承認とファイルの書き込み 設計書](./15-tool-approval.md) | 実行前に利用者の承認を挟む仕組み（ストリームの中で待つ）と、ファイルの作成・編集のツール（#148 Phase A2） |
| 16 | [コマンドの実行 設計書](./16-command-execution.md) | 許可したコマンドの実行（シェルを介さない）・許可リスト・作業フォルダ・実行前の承認・プロセスの停止（#148 Phase B） |
| 17 | [GitHub のツール 設計書](./17-github-tools.md) | 許可したリポジトリの PR・issue の読み取り（承認なし）・コメントと PR の作成（実行前の承認）・`gh` の引数をアプリが組み立てる（#148 Phase C） |
| 18 | [ブラウザのツール 設計書](./18-browser-tools.md) | ページを開いてアクセシビリティツリー・スクリーンショットで読むツール、開いてよい URL（プロキシで接続ごとに判定）・応答ごとのセッション（#149 Phase A・B） |
| 19 | [トークン数・生成速度の表示 設計書](./19-token-metrics.md) | Ollama の終わりのチャンクのメトリクスを集め、応答ごとにトークン数・生成速度を表示する（通常のチャットも NDJSON に・`metadata.metrics` に保存。#31 Phase A・B） |
| 20 | [プロンプトテンプレート 設計書](./20-prompt-templates.md) | よく使うプロンプトを保存し、入力欄の先頭の `/` で候補を出して本文を入れる（DB の `PromptTemplate`・CRUD の API・管理画面。#28 Phase A・B） |
| 21 | [応答のブックマーク 設計書](./21-bookmarks.md) | 応答にブックマークを付け、会話をまたいだ一覧（キーワード検索・メモ）から元の会話のその応答へ移る（DB の `Bookmark`・`/api/bookmarks`。#30 Phase A・B） |
| 22 | [会話の分岐 設計書](./22-conversation-fork.md) | 応答の位置から、そこまでのやり取りを新しい会話にコピーして別の方向で続ける（会話の中のツリーにはしない・分岐元へのリンク・`POST /api/conversations/[id]/fork`。#29） |
| 23 | [ショートカットキー 設計書](./23-keyboard-shortcuts.md) | 新しい会話・会話の検索・サイドバーの開閉・入力欄へのフォーカス・前後の会話のキーと、サイドバーの一覧の ↑↓ の移動・ショートカットの一覧のヘルプ（#33） |
| 24 | [HTML レポートと PDF の書き出し 設計書](./24-html-report-export.md) | 応答・会話をスタイル付きの 1 ファイルの HTML（図・画像を埋め込む）で保存し、同じ HTML をブラウザの印刷で PDF にする（#36 Phase A・E） |
| 25 | [DOCX の書き出し 設計書](./25-docx-export.md) | 応答・会話を Word で開ける DOCX で保存する（Markdown → 文書の中間の形 → npm の docx。図は PNG・添付画像を埋め込む。#36 Phase C） |

## 進捗・計画

「今どこまで／次に何を」を管理する。**未着手の実装順は 10（ロードマップ）が正準**、07 はタスクの詳細チェックリスト。

| # | ドキュメント | 概要 |
|---|---|---|
| 07 | [タスク一覧](./07-tasks.md) | フェーズ別チェックリスト・進捗管理（番号は ID） |
| 10 | [開発ロードマップ](./10-roadmap.md) | 残フェーズの優先順位・実装順序（順序の正準） |

## 記録（履歴）

過去の事象・対応の記録。仕様ではない。

| # | ドキュメント | 概要 |
|---|---|---|
| 08 | [CI E2E バグレポート](./08-ci-e2e-bug-report.md) | CI で発生した E2E 不具合と対処の記録 |

## LLM モデル評価（`models/`）

使用している Ollama モデルの仕様・実測値・挙動の違い。連番ではなくディレクトリで管理し、モデルごとに 1 ファイル置く。

| ドキュメント | 概要 |
|---|---|
| [モデル評価（一覧・比較）](./models/README.md) | 3 モデルの比較・挙動の違い（思考過程・think・tool_calls）・追加時の確認項目 |
| [qwen3.8:27b](./models/qwen3.8-27b.md) | アプリの既定モデル |
| [qwen3-coder-next:latest](./models/qwen3-coder-next.md) | 旧既定モデル |
| [qwen2.5:0.5b](./models/qwen2.5-0.5b.md) | E2E の既定モデル |

## 構成図（`diagrams/`）

draw.io の図。連番ではなくディレクトリで管理する。正準は `architecture.drawio`（5 ページ）で、PNG は閲覧用の写し。更新の手順は [`diagrams/README.md`](./diagrams/README.md)。

| ページ | 概要 |
|---|---|
| [全体アーキテクチャ](./diagrams/01-architecture.png) | ブラウザ・Next.js サーバー・ホストのプロセス・Docker Compose・インターネットと、その間の通信 |
| [Ollama とアプリの責務（パターン表）](./diagrams/02-ollama-responsibilities.png) | 10 のパターンごとの Ollama とアプリの仕事・承認・その後の応答への制約 |
| [シーケンス A 基本の往復](./diagrams/03-sequence-a-basic.png) | 通常のチャット・画像の添付・タイトルの生成 |
| [シーケンス B ツールの往復](./diagrams/04-sequence-b-tools.png) | 承認なしのツール（エージェントのループの骨格） |
| [シーケンス C 承認を挟む往復](./diagrams/05-sequence-c-approval.png) | 書き込み・コマンド・GitHub への投稿・ブラウザの操作 |

## 関連

- 開発ルール: [`../CLAUDE.md`](../CLAUDE.md) と [`../.claude/rules/`](../.claude/rules/)
- ドキュメント更新の影響マップ: [`../.claude/rules/documentation.md`](../.claude/rules/documentation.md)
- セットアップガイド: [`../manuals/setup-guide-macos.md`](../manuals/setup-guide-macos.md)
