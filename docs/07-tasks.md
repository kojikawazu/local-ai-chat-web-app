# タスク一覧

> 最終更新: 2026-10-17
>
> フェーズ番号は **ID（追加順）** であり、実装の優先順位ではありません。未着手フェーズ（12 以降）の **実装順は [10-roadmap.md](./10-roadmap.md) を正準** とします。

## 目次

- [フェーズ0: プロジェクト基盤](#フェーズ0-プロジェクト基盤)
- [フェーズ1: 画面実装](#フェーズ1-画面実装)
- [フェーズ2: Ollama連携](#フェーズ2-ollama連携)
- [フェーズ3: 会話履歴の永続化](#フェーズ3-会話履歴の永続化)
- [フェーズ4: セキュリティ対策](#フェーズ4-セキュリティ対策)
- [フェーズ5: E2Eテスト](#フェーズ5-e2eテスト)
- [フェーズ6: CI](#フェーズ6-ci)
- [フェーズ7: 既存機能の改善・バグ修正](#フェーズ7-既存機能の改善バグ修正)
- [フェーズ8: 新機能](#フェーズ8-新機能)
- [フェーズ9: ドキュメント整理](#フェーズ9-ドキュメント整理)
- [フェーズ10: CI環境構築・修正](#フェーズ10-ci環境構築修正)
- [フェーズ11: マニュアル・レポート](#フェーズ11-マニュアルレポート)
- [フェーズ12: 音声対話機能](#フェーズ12-音声対話機能)
  - [12-1: 調査・設計](#12-1-調査設計)
  - [12-2: 音声入力（STT: Speech-to-Text）](#12-2-音声入力stt-speech-to-text)
  - [12-3: 音声出力（TTS: Text-to-Speech）](#12-3-音声出力tts-text-to-speech)
  - [12-4: 音声対話UI](#12-4-音声対話ui)
  - [12-5: 統合・最適化](#12-5-統合最適化)
  - [12-6: E2Eテスト](#12-6-e2eテスト)
  - [12-7: ドキュメント](#12-7-ドキュメント)
- [フェーズ13: 画像添付機能（マルチモーダル対応）](#フェーズ13-画像添付機能マルチモーダル対応)
  - [13-1: 調査・設計](#13-1-調査設計)
  - [13-2: 画像アップロード](#13-2-画像アップロード)
  - [13-3: API・バックエンド](#13-3-apiバックエンド)
  - [13-4: チャット表示](#13-4-チャット表示)
  - [13-5: E2Eテスト](#13-5-e2eテスト)
  - [13-6: ドキュメント](#13-6-ドキュメント)
- [フェーズ14: コピー機能の実装・UX改善](#フェーズ14-コピー機能の実装ux改善)
  - [14-1: コピー機能実装](#14-1-コピー機能実装)
  - [14-2: コピーフィードバックUI](#14-2-コピーフィードバックui)
  - [14-3: E2Eテスト](#14-3-e2eテスト)
  - [14-4: ドキュメント](#14-4-ドキュメント)
- [フェーズ15: ストリーミング停止ボタン](#フェーズ15-ストリーミング停止ボタン)
  - [15-1: 停止機能実装](#15-1-停止機能実装)
  - [15-2: 停止ボタンUI](#15-2-停止ボタンui)
  - [15-3: E2Eテスト](#15-3-e2eテスト)
  - [15-4: ドキュメント](#15-4-ドキュメント)
- [フェーズ16: メッセージ再生成（リトライ）](#フェーズ16-メッセージ再生成リトライ)
  - [16-1: 再生成機能実装](#16-1-再生成機能実装)
  - [16-2: 再生成UI](#16-2-再生成ui)
  - [16-3: E2Eテスト](#16-3-e2eテスト)
  - [16-4: ドキュメント](#16-4-ドキュメント)
- [フェーズ17: システムプロンプト設定](#フェーズ17-システムプロンプト設定)
  - [17-1: 設計・DB](#17-1-設計db)
  - [17-2: API・バックエンド](#17-2-apiバックエンド)
  - [17-3: UI](#17-3-ui)
  - [17-4: E2Eテスト](#17-4-e2eテスト)
  - [17-5: ドキュメント](#17-5-ドキュメント)
- [フェーズ18: 会話検索機能](#フェーズ18-会話検索機能)
  - [18-1: バックエンド](#18-1-バックエンド)
  - [18-2: UI](#18-2-ui)
  - [18-3: E2Eテスト](#18-3-e2eテスト)
  - [18-4: ドキュメント](#18-4-ドキュメント)
- [フェーズ19: 個別メッセージのMarkdownエクスポート](#フェーズ19-個別メッセージのmarkdownエクスポート)
  - [19-1: 個別メッセージコピー](#19-1-個別メッセージコピー)
  - [19-2: 個別メッセージダウンロード](#19-2-個別メッセージダウンロード)
  - [19-3: 会話全体エクスポート（任意）](#19-3-会話全体エクスポート任意)
  - [19-4: E2Eテスト](#19-4-e2eテスト)
  - [19-5: ドキュメント](#19-5-ドキュメント)
- [フェーズ20: シンタックスハイライト・図表レンダリング](#フェーズ20-シンタックスハイライト図表レンダリング)
  - [20-1: シンタックスハイライト](#20-1-シンタックスハイライト)
  - [20-2: Mermaid図表レンダリング](#20-2-mermaid図表レンダリング)
  - [20-3: PlantUML図表レンダリング](#20-3-plantuml図表レンダリング)
  - [20-4: 図表の共通UI](#20-4-図表の共通ui)
  - [20-5: E2Eテスト](#20-5-e2eテスト)
  - [20-6: ドキュメント](#20-6-ドキュメント)
- [フェーズ21: エージェント機能（ツール呼び出し）](#フェーズ21-エージェント機能ツール呼び出し)
  - [21-1: Phase A — ツール呼び出し基盤](#21-1-phase-a--ツール呼び出し基盤)
    - [21-1-1: 型定義・ツールレジストリ](#21-1-1-型定義ツールレジストリ)
    - [21-1-2: 基本ツール実装](#21-1-2-基本ツール実装)
    - [21-1-3: Ollama 連携拡張](#21-1-3-ollama-連携拡張)
    - [21-1-4: エージェントループ実装](#21-1-4-エージェントループ実装)
    - [21-1-5: API 変更](#21-1-5-api-変更)
    - [21-1-6: DB スキーマ変更](#21-1-6-db-スキーマ変更)
    - [21-1-7: フロントエンド基盤](#21-1-7-フロントエンド基盤)
    - [21-1-8: 設定 UI](#21-1-8-設定-ui)
    - [21-1-9: E2E テスト（Phase A）](#21-1-9-e2e-テストphase-a)
  - [21-2: Phase B — 調査系ツール追加](#21-2-phase-b--調査系ツール追加)
    - [21-2-1: Web 検索ツール](#21-2-1-web-検索ツール)
    - [21-2-2: URL 取得ツール](#21-2-2-url-取得ツール)
    - [21-2-3: フロントエンド拡張](#21-2-3-フロントエンド拡張)
    - [21-2-4: E2E テスト（Phase B）](#21-2-4-e2e-テストphase-b)
  - [21-3: Phase C — 自律エージェント化](#21-3-phase-c--自律エージェント化)
    - [21-3-1: システムプロンプト設計](#21-3-1-システムプロンプト設計)
    - [21-3-2: 思考過程の可視化](#21-3-2-思考過程の可視化)
    - [21-3-3: エージェントループの強化](#21-3-3-エージェントループの強化)
    - [21-3-4: E2E テスト（Phase C）](#21-3-4-e2e-テストphase-c)
  - [21-4: ドキュメント](#21-4-ドキュメント)
- [フェーズ22: 開発ルールの拡充（`.claude/rules/`）](#フェーズ22-開発ルールの拡充clauderules)
- [フェーズ23: コードと `.claude/rules/` の乖離解消](#フェーズ23-コードと-clauderules-の乖離解消)
- [フェーズ24: CI 発火条件の最適化](#フェーズ24-ci-発火条件の最適化)
- [フェーズ25: Prettier 整形と品質チェックの CI 機械強制](#フェーズ25-prettier-整形と品質チェックの-ci-機械強制)
- [フェーズ26: リポジトリ全体レビュー指摘の修正・CI 衛生](#フェーズ26-リポジトリ全体レビュー指摘の修正ci-衛生)
  - [26-1: P1 — データ消失・リソース枯渇・操作不能](#26-1-p1--データ消失リソース枯渇操作不能)
  - [26-2: P2 — API 契約・永続化の不整合](#26-2-p2--api-契約永続化の不整合)
  - [26-3: CI 衛生](#26-3-ci-衛生)

## フェーズ0: プロジェクト基盤

- [x] Next.jsプロジェクト初期セットアップ（pnpm, TypeScript, TailwindCSS）
- [x] ESLint + Prettier設定
- [x] Playwright導入・設定
- [x] 環境変数設定（.env.local）
- [x] ディレクトリ構成の作成
- [x] Docker Compose設定（PostgreSQL）
- [x] Prisma導入・スキーマ定義・初回マイグレーション

## フェーズ1: 画面実装

- [x] ルートレイアウト（layout.tsx）作成
- [x] Sidebarコンポーネント実装
- [x] Headerコンポーネント実装
- [x] ChatWindowコンポーネント実装
- [x] ChatBarコンポーネント実装
- [x] Footerコンポーネント実装
- [x] Nordic Frostテーマ（TailwindCSS設定）適用
- [x] レスポンシブデザイン対応

## フェーズ2: Ollama連携

- [x] Ollamaクライアント実装（lib/ollama.ts）
- [x] Route Handler実装（POST /api/chat）
- [x] ストリーミングレスポンス実装
- [x] フロントエンドのストリーミング表示実装
- [x] エラーハンドリング（接続失敗、タイムアウト等）

## フェーズ3: 会話履歴の永続化

- [x] Prismaクライアント実装（lib/prisma.ts）
- [x] 会話CRUD API実装（/api/conversations）
- [x] メッセージCRUD API実装（/api/conversations/[id]/messages）
- [x] サイドバーに会話一覧を表示
- [x] 会話の選択・切り替え機能
- [x] 新規会話の作成機能
- [x] 会話の削除機能
- [x] チャット送信時のDB保存連携

## フェーズ4: セキュリティ対策

- [x] CSPヘッダー設定（next.config.ts）
- [x] 入力バリデーション実装（フロントエンド: 空入力・10,000文字制限）
- [x] 入力バリデーション実装（API: 空入力・10,000文字制限・型チェック・UUIDフォーマット）
- [x] エラーハンドリング統一（API共通のエラーレスポンス形式）
- [x] 環境変数の.gitignore確認

## フェーズ5: E2Eテスト

※ 全テストファイルに正常系・準正常系・異常系の3分類を必ず含めること

- [x] playwright.config.ts作成（Chromium、失敗時スクリーンショット+トレース、リトライ1回）
- [x] テストデータ管理の共通ヘルパー作成（セットアップ/クリーンアップ）
- [x] チャット機能テスト（chat.spec.ts: 正常系/準正常系/異常系 — 送信、Enter/Shift+Enter、自動スクロール、空入力拒否、文字数制限）
- [x] ストリーミング表示テスト（chat-streaming.spec.ts: 正常系/準正常系/異常系 — リアルタイム表示、応答内容検証、短い応答、接続切断）
- [x] サイドバー操作テスト（sidebar.spec.ts: 正常系/準正常系/異常系 — 会話一覧、選択、0件状態、存在しないID）
- [x] 会話管理テスト（conversation.spec.ts: 正常系/準正常系/異常系 — 作成、切替、削除、永続化、長文保存、削除済みアクセス）
- [x] セキュリティテスト（security.spec.ts: 正常系/準正常系/異常系 — 通常テキスト、HTMLエスケープ、XSS、SQLi、文字数超過）
- [x] レスポンシブテスト（responsive.spec.ts: 正常系/準正常系/異常系 — デスクトップ/モバイル、リサイズ追従、極小ビューポート）
- [x] スクリーンショットテスト（初期表示、チャット中、サイドバー展開、エラー表示、モバイル）

### ユニットテスト（Vitest）導入

- [x] Vitest 導入・`vitest.config.ts` 作成（`tests/unit/**` 対象・`@/*` エイリアス解決・node 環境）
- [x] `pnpm test:unit` / `test:unit:watch` スクリプト追加
- [x] validation.test.ts（isValidUUID・入力上限定数: 正常系/準正常系/異常系）
- [x] calculate.test.ts（式評価パーサー: 優先順位/括弧/単項マイナス/ゼロ除算/不正式 等）
- [x] agent-prompts.test.ts（getPresetById・プリセット不変条件）
- [x] CI に独立ジョブ `unit-test`（`.github/workflows/unit-test.yml`）を追加
- [x] 方針ドキュメント更新（`.claude/rules/testing.md`・`docs/06`・`CLAUDE.md`・`README`）

### インテグレーションテスト（Vitest + Testcontainers）導入

- [x] `@testcontainers/postgresql` 導入・`vitest.integration.config.ts`（globalSetup で使い捨てPostgreSQL起動→`migrate deploy`、setup-env で接続URL注入）
- [x] `pnpm test:integration` スクリプト追加
- [x] conversations.test.ts（作成/一覧: 3分類）
- [x] conversation-delete.test.ts（削除・cascade・UUID400・存在しないID500）
- [x] messages.test.ts（保存/取得・metadata・updatedAt・400/404）
- [x] route handler をブラウザ抜きで直接叩く方式（NextRequest 構築）・実DBで検証
- [x] CI に独立ジョブ `integration-test`（`.github/workflows/integration-test.yml`。Docker のみ・Ollama不要）を追加
- [x] 方針ドキュメント更新（3層構成へ改定）
- [x] IT 補強＋エラー契約の移譲: `/api/chat`・`/api/models` を Ollama fetch スタブで検証（`helpers/ollama-stub.ts`）。Ollamaダウン→502・空/超過/不正JSON→400 を IT 化（E2E の障害注入から移譲）。層分担（契約=IT / UI描画=E2E）を testing.md・docs/06 に明文化

## フェーズ6: CI

- [x] GitHub Actionsワークフロー作成（push/PR to main）
- [x] CI環境でのDocker Compose + Ollama + Playwright実行
- [x] テスト結果・スクリーンショット・トレースをArtifactにアップロード

## フェーズ7: 既存機能の改善・バグ修正

- [x] IME入力対応（日本語入力中のEnterで送信されない改善 — compositionstart/end対応）
- [x] New Conversationボタンの動作改善（クリック時のUX見直し）
- [x] モデル選択機能の実装（Ollamaの利用可能モデル一覧取得 → Header上で選択可能に）

## フェーズ8: 新機能

- [x] 設定画面の実装（設定ボタンにonClick追加、設定モーダル/ページ作成）
- [x] マークダウン表示対応（AIレスポンスのコードブロック・リスト等を整形表示）
- [x] 会話タイトル自動生成（最初のメッセージ内容からLLMでタイトル生成）
- [x] テーマ切替（Nordic Frost以外のテーマ対応、設定画面から切替）

## フェーズ9: ドキュメント整理

- [x] docs/01-requirements.md 更新（追加機能の要件反映）
- [x] docs/02-architecture.md 更新（新コンポーネント・API・テーマシステム・ディレクトリ構成反映）
- [x] docs/03-api-design.md 更新（GET /api/models、POST generate-title、modelパラメータ追加）
- [x] docs/05-security.md 更新（react-markdownのXSSセキュリティ記述追加）
- [x] docs/06-testing.md 更新（新機能のテストシナリオ・ファイル構成追加）
- [x] CLAUDE.md 更新（テーマシステム・新コンポーネント・依存パッケージ反映）
- [x] README.md 作成（プロジェクト概要・セットアップ手順・機能一覧）

## フェーズ10: CI環境構築・修正

- [x] GitHub Actionsワークフロー作成（`.github/workflows/e2e-test.yml`）
- [x] CI環境でのディスク容量確保（不要SDK削除）
- [x] CIモデル選定（`qwen3-coder:latest` → `qwen3:0.6b` → `qwen2.5:0.5b`）
- [x] Prismaクライアント生成ステップ追加
- [x] E2EテストのCI対応修正（ウェルカムテキスト、Clipboard API、strict mode、タイムアウト等 計18件）
- [x] ストリーミング完了テストのCIスキップ設定（CPU onlyでは完了しない）
- [x] Shift+EnterテストのCI安定化（明示的キーボード操作）
- [x] CI E2Eテスト全通過確認

## フェーズ11: マニュアル・レポート

- [x] macOS向けセットアップガイド作成（`manuals/setup-guide-macos.md`）
- [x] CI E2Eテストバグレポート作成（`docs/08-ci-e2e-bug-report.md`）
- [x] 全ドキュメント最終更新（CI・マニュアル・バグレポート反映）

## フェーズ12: 音声対話機能

テキストチャットに加え、ローカルLLMとの音声対話を実現する。
マイクで話しかけ → STTでテキスト化 → LLM応答 → TTSで音声再生 の一連フローを構築する。

### 12-1: 調査・設計

- [ ] 音声対話の技術選定（STT: Whisper等、TTS: Web Speech API / Piper等）
- [ ] 音声対話のアーキテクチャ設計（`docs/12-voice-dialogue.md` 作成）
- [ ] 音声対話のデータフロー設計（録音 → STT → LLM → TTS → 再生）

### 12-2: 音声入力（STT: Speech-to-Text）

- [ ] ブラウザでの音声録音機能実装（MediaRecorder API）
- [ ] 音声データのフォーマット・エンコーディング処理
- [ ] STT用 Route Handler 実装（POST /api/speech-to-text）
- [ ] STTモデル連携実装（Whisper等のローカルSTTエンジン）
- [ ] 録音 → テキスト変換の一連フロー結合

### 12-3: 音声出力（TTS: Text-to-Speech）

- [ ] TTS エンジン選定・導入（ローカルTTS or Web Speech API）
- [ ] TTS用 Route Handler 実装（POST /api/text-to-speech）
- [ ] ブラウザでの音声再生機能実装（Audio API）
- [ ] テキスト → 音声変換・再生の一連フロー結合

### 12-4: 音声対話UI

- [ ] マイクボタンコンポーネント実装（ChatBarに追加）
- [ ] 録音中インジケーター（波形アニメーション等）
- [ ] AI応答の音声再生コントロール（再生/停止ボタン）
- [ ] 音声対話設定の追加（設定モーダルに音声ON/OFF・言語選択等）

### 12-5: 統合・最適化

- [ ] 既存チャットフローとの統合（音声入力 → テキスト表示 → LLM → 音声出力）
- [ ] ストリーミング応答との連携（テキスト蓄積後にTTS変換）
- [ ] エラーハンドリング（マイク権限拒否、STT/TTS失敗、デバイス未検出等）
- [ ] レスポンシブデザイン対応（モバイルでの音声操作）

### 12-6: E2Eテスト

- [ ] 音声対話E2Eテスト作成（voice-dialogue.spec.ts: 正常系/準正常系/異常系）
- [ ] マイクUI操作テスト（ボタン表示、録音状態切替、権限拒否時の表示）
- [ ] 音声再生テスト（再生/停止コントロール、エラー表示）

### 12-7: ドキュメント

- [ ] `docs/12-voice-dialogue.md` 作成（音声対話設計書）
- [ ] 既存ドキュメント更新（requirements, architecture, API設計, CLAUDE.md等）

## フェーズ13: 画像添付機能（マルチモーダル対応）

チャットに画像を添付し、Ollamaのマルチモーダル対応モデル（llava等）に画像を渡して応答を得る。

### 13-1: 調査・設計

- [ ] マルチモーダル対応の技術調査（Ollama images API、対応モデル一覧）
- [ ] 画像添付のアーキテクチャ設計（データフロー・保存方式の決定）

### 13-2: 画像アップロード

- [ ] 画像選択UI実装（ChatBarにファイル添付ボタン追加）
- [ ] ドラッグ＆ドロップによる画像添付対応
- [ ] クリップボードからの画像貼り付け対応（Ctrl+V / Cmd+V）
- [ ] 画像プレビュー表示（送信前の確認・削除）
- [ ] 画像バリデーション（ファイル形式制限、サイズ上限設定）

### 13-3: API・バックエンド

- [ ] 画像のBase64エンコーディング処理
- [ ] POST /api/chat の拡張（images パラメータ追加）
- [ ] Ollama API連携の拡張（images フィールド送信）
- [ ] マルチモーダル非対応モデル使用時のエラーハンドリング

### 13-4: チャット表示

- [ ] チャット履歴内の画像表示コンポーネント実装
- [ ] 画像のサムネイル表示・クリックで拡大表示
- [ ] 画像付きメッセージのDB保存方式実装（Base64 or ファイルパス）
- [ ] 画像付きメッセージの復元表示（会話切替・リロード時）

### 13-5: E2Eテスト

- [ ] 画像添付E2Eテスト作成（image-upload.spec.ts: 正常系/準正常系/異常系）
- [ ] 画像アップロードUIテスト（添付・プレビュー・削除・バリデーション）

### 13-6: ドキュメント

- [ ] `docs/10-image-upload.md` 作成（画像添付設計書）
- [ ] 既存ドキュメント更新（API設計、architecture、CLAUDE.md等）

## フェーズ14: コピー機能の実装・UX改善

AI応答のコピーボタンが未実装（アイコンのみ表示でonClickハンドラなし）。
コピー機能自体の実装と、コピー完了のビジュアルフィードバックを追加する。

### 14-1: コピー機能実装

- [ ] AI応答全体のコピー機能実装（Clipboard API + onClickハンドラ）
- [ ] コードブロック個別のコピーボタン追加（MarkdownContent.tsx）
- [ ] Clipboard API 非対応環境へのフォールバック（execCommand等）

### 14-2: コピーフィードバックUI

- [ ] コピー完了時のアイコン変化（Copy → Check アイコンに一時切替）
- [ ] コピー完了のツールチップ/トースト表示（「コピーしました」）
- [ ] フィードバックの自動リセット（2〜3秒後に元のアイコンに戻す）
- [ ] コピー失敗時のエラー表示

### 14-3: E2Eテスト

- [ ] コピー機能E2Eテスト作成（copy.spec.ts: 正常系/準正常系/異常系）
- [ ] コピーボタン操作テスト（クリック、フィードバック表示、リセット確認）

### 14-4: ドキュメント

- [ ] 既存ドキュメント更新（CLAUDE.md等）

## フェーズ15: ストリーミング停止ボタン

AI応答のストリーミング生成中に「Stop」ボタンで中断できるようにする。
ローカルLLMは応答が遅い場合があり、不要な長文生成を途中で止めたい需要がある。

### 15-1: 停止機能実装

- [ ] AbortController によるfetchリクエストの中断機能実装
- [ ] ストリーミング中断時のOllama側リソース解放確認
- [ ] 中断時の部分応答のDB保存（途中までのテキストを保存するか破棄するかの方針決定）
- [ ] ストリーミング状態管理の拡張（idle / streaming / aborting）

### 15-2: 停止ボタンUI

- [ ] ストリーミング中のStopボタン表示（送信ボタンと切替 or ChatWindow内に配置）
- [ ] 停止アニメーション・フィードバック表示
- [ ] キーボードショートカット対応（Escape等で停止）

### 15-3: E2Eテスト

- [ ] ストリーミング停止E2Eテスト作成（streaming-stop.spec.ts: 正常系/準正常系/異常系）

### 15-4: ドキュメント

- [ ] 既存ドキュメント更新（CLAUDE.md等）

## フェーズ16: メッセージ再生成（リトライ）

AIの応答が不満なとき、同じ質問で応答を再生成する機能。

### 16-1: 再生成機能実装

- [ ] 最後のAI応答を削除して同じメッセージで再送信するロジック
- [ ] 再生成時のDB更新（旧AI応答を削除 → 新AI応答を保存）
- [ ] ストリーミング中は再生成ボタンを無効化

### 16-2: 再生成UI

- [ ] AI応答メッセージ下部に再生成ボタン（RefreshCw アイコン等）配置
- [ ] 再生成中のローディング表示
- [ ] 再生成完了時のフィードバック

### 16-3: E2Eテスト

- [ ] メッセージ再生成E2Eテスト作成（regenerate.spec.ts: 正常系/準正常系/異常系）

### 16-4: ドキュメント

- [ ] 既存ドキュメント更新（CLAUDE.md等）

## フェーズ17: システムプロンプト設定

AIの人格・役割をカスタマイズするシステムプロンプト機能。
会話ごとに「翻訳者」「コードレビュアー」「日本語教師」等の役割を設定できる。

### 17-1: 設計・DB

- [ ] システムプロンプトの保存方式決定（会話単位 or グローバル or 両方）
- [ ] DBスキーマ拡張（Conversationモデルに systemPrompt フィールド追加等）
- [ ] マイグレーション作成・実行

### 17-2: API・バックエンド

- [ ] POST /api/chat の拡張（system ロールメッセージの先頭挿入）
- [ ] 会話作成/更新APIでシステムプロンプトを保存
- [ ] プリセットテンプレートの管理（翻訳者、コードレビュアー等）

### 17-3: UI

- [ ] 設定モーダルにシステムプロンプト入力欄追加
- [ ] プリセット選択ドロップダウン（カスタム入力も可）
- [ ] 会話ごとのシステムプロンプト表示・編集
- [ ] 現在のシステムプロンプトのインジケーター表示（Header等）

### 17-4: E2Eテスト

- [ ] システムプロンプトE2Eテスト作成（system-prompt.spec.ts: 正常系/準正常系/異常系）

### 17-5: ドキュメント

- [ ] 既存ドキュメント更新（API設計、architecture、CLAUDE.md等）

## フェーズ18: 会話検索機能

サイドバーに検索バーを追加し、過去の会話・メッセージをキーワードで全文検索する。

### 18-1: バックエンド

- [ ] 検索用API実装（GET /api/conversations/search?q=キーワード）
- [ ] PostgreSQL検索実装（会話タイトル + メッセージ本文の ILIKE or 全文検索）
- [ ] 検索結果のページネーション（大量結果対応）

### 18-2: UI

- [ ] サイドバーに検索バー追加（虫眼鏡アイコン + 入力欄）
- [ ] 検索結果一覧の表示（マッチした会話 + マッチ箇所のスニペット）
- [ ] 検索結果から会話への遷移
- [ ] 検索キーワードのハイライト表示
- [ ] デバウンス処理（入力中の過剰なAPI呼び出し防止）

### 18-3: E2Eテスト

- [ ] 会話検索E2Eテスト作成（search.spec.ts: 正常系/準正常系/異常系）

### 18-4: ドキュメント

- [ ] 既存ドキュメント更新（API設計、CLAUDE.md等）

## フェーズ19: 個別メッセージのMarkdownエクスポート

AI応答の個別メッセージをMarkdown形式でコピー・ダウンロードする機能。
全会話ではなく、特定の1応答だけを取り出したい需要に対応する。

### 19-1: 個別メッセージコピー

- [ ] AI応答メッセージの生Markdown（レンダリング前のテキスト）をコピーする機能
- [ ] コピーボタンのUI配置（メッセージごとにMarkdownコピーアイコン追加）
- [ ] コピー完了のフィードバック表示（フェーズ14のコピーフィードバックと共通化）

### 19-2: 個別メッセージダウンロード

- [ ] AI応答1件を .md ファイルとしてダウンロードする機能
- [ ] ダウンロードボタンのUI配置（Download アイコン）
- [ ] ファイル名の自動生成（会話タイトル + タイムスタンプ等）

### 19-3: 会話全体エクスポート（任意）

- [ ] 会話全体をMarkdown形式でエクスポート（ユーザー/AI応答を交互に記載）
- [ ] 会話全体をJSON形式でエクスポート（バックアップ用途）
- [ ] サイドバーの会話メニューにエクスポートボタン追加

### 19-4: E2Eテスト

- [ ] エクスポートE2Eテスト作成（export.spec.ts: 正常系/準正常系/異常系）

### 19-5: ドキュメント

- [ ] 既存ドキュメント更新（CLAUDE.md等）

## フェーズ20: シンタックスハイライト・図表レンダリング

コードブロックに言語別のシンタックスハイライトを適用し、
Mermaid / PlantUML のコードブロックを図表としてレンダリングする。

現状: `react-markdown` でコードブロックは表示されるが全言語同一色（`text-nord-6`）。図表レンダリングは未対応。

### 20-1: シンタックスハイライト

- [ ] ハイライトライブラリの選定・導入（highlight.js / Prism / Shiki）
- [ ] Nordテーマ対応のカラースキーム設定
- [ ] MarkdownContent.tsx のコードブロックコンポーネント拡張
- [ ] 言語名の表示（コードブロック右上に「typescript」「python」等のラベル）
- [ ] 対応言語: bash, javascript, typescript, java, go, python, rust, SQL, JSON, YAML, HTML, CSS 等

### 20-2: Mermaid図表レンダリング

- [ ] mermaid ライブラリの導入（npm パッケージ）
- [ ] `language-mermaid` コードブロックの検出・図表レンダリング
- [ ] Mermaid図表のNordテーマスタイリング
- [ ] レンダリングエラー時のフォールバック表示（ソースコードをそのまま表示）

### 20-3: PlantUML図表レンダリング

- [ ] PlantUML レンダリング方式の選定（ローカルサーバー / WASM / Docker）
- [ ] PlantUMLサーバーの導入（docker-compose.yml への追加等）
- [ ] `language-plantuml` コードブロックの検出・図表レンダリング
- [ ] レンダリングエラー時のフォールバック表示

### 20-4: 図表の共通UI

- [ ] 図表のズーム・拡大表示機能
- [ ] 図表のPNG/SVGエクスポートボタン
- [ ] ソースコード表示と図表表示の切替トグル

### 20-5: E2Eテスト

- [ ] シンタックスハイライトE2Eテスト作成（syntax-highlight.spec.ts: 正常系/準正常系/異常系）
- [ ] 図表レンダリングE2Eテスト作成（diagram.spec.ts: 正常系/準正常系/異常系）

### 20-6: ドキュメント

- [ ] `docs/11-syntax-highlight-diagrams.md` 作成（シンタックスハイライト・図表レンダリング設計書）
- [ ] 既存ドキュメント更新（requirements, architecture, CLAUDE.md等）

## フェーズ21: エージェント機能（ツール呼び出し）

LLM がツールを呼び出して外部情報を取得・処理できるエージェント機能。
段階的に構築: Phase A（基盤）→ Phase B（調査系ツール）→ Phase C（自律エージェント）。
設計書: `docs/09-agent-architecture.md`、GitHub issue: #16

### 21-1: Phase A — ツール呼び出し基盤

#### 21-1-1: 型定義・ツールレジストリ

- [x] ツール関連の型定義作成（`lib/tools/types.ts` — OllamaToolDefinition, OllamaToolCall, ToolCallRecord, AgentStreamEvent）
- [x] ツールレジストリ実装（`lib/tools/index.ts` — registerTool, getTool, getAllToolDefinitions, executeTool）
- [x] フロントエンド型拡張（`types/index.ts` — Message に metadata フィールド追加、ToolCallInfo 型追加）

#### 21-1-2: 基本ツール実装

- [x] get_current_datetime ツール実装（`lib/tools/get-current-datetime.ts`）
- [x] calculate ツール実装（`lib/tools/calculate.ts` — 安全な数式パーサー、許可文字の正規表現制限）

#### 21-1-3: Ollama 連携拡張

- [x] `lib/ollama.ts` 拡張 — OllamaChatMessage に tool_calls, role: 'tool' / 'system' 対応追加
- [x] `lib/ollama.ts` 拡張 — streamChat に tools パラメータ追加
- [x] OllamaStreamChunk 型拡張 — tool_calls フィールド追加

#### 21-1-4: エージェントループ実装

- [x] `lib/agent.ts` 作成 — ツール呼び出しループ（最大ラウンド制限付き）
- [x] Ollama レスポンス解析 — テキスト応答 / tool_calls の判定分岐
- [x] ツール実行 → tool ロールでの結果返送 → Ollama 再呼び出しの一連フロー
- [x] 複数ツール同時呼び出し対応（tool_calls 配列の並列実行）

#### 21-1-5: API 変更

- [x] POST /api/chat 拡張 — enableTools / systemPrompt パラメータ追加、NDJSON イベントストリーム対応
- [x] エラーハンドリング — ツール実行失敗、タイムアウト、最大ラウンド超過
- ※ GET /api/tools は実装済（利用可能ツール一覧を返す）。ツール個別選択 UI は設けず、設定 UI で直接プリセット選択方式を採用

#### 21-1-6: DB スキーマ変更

- [x] Message モデルに metadata (Json?) フィールド追加
- [x] Prisma マイグレーション作成・実行
- [x] メッセージ保存 API — metadata フィールド対応

#### 21-1-7: フロントエンド基盤

- [x] useChat フック拡張 — NDJSON パーサー追加、プレーンテキストとの後方互換
- [x] useChat フック拡張 — ツール状態管理（activeToolCall）、メタデータ蓄積
- [x] ToolCallIndicator コンポーネント実装（ツール実行中のスピナー表示）
- [x] ToolCallResult コンポーネント実装（実行結果の折りたたみ表示）
- [x] ChatWindow 変更 — ツール呼び出し情報の表示統合

#### 21-1-8: 設定 UI

- [x] 設定モーダルにエージェント ON/OFF トグル追加
- [x] エージェント設定の状態管理（localStorage 永続化）
- [x] 環境変数追加（AGENT_MAX_TOOL_ROUNDS, AGENT_TOOL_TIMEOUT_MS）

#### 21-1-9: E2E テスト（Phase A）

- [x] エージェント基盤 E2E テスト作成（agent-phase-a.spec.ts: 正常系/準正常系/異常系）
- [x] ツール呼び出し表示テスト（インジケーター表示、結果表示）
- [x] エージェント ON/OFF 切替テスト
- [x] エラーハンドリングテスト（ツール実行失敗、タイムアウト）

### 21-2: Phase B — 調査系ツール追加

#### 21-2-1: Web 検索ツール

- [x] web_search ツール実装（`lib/tools/web-search.ts` — DuckDuckGo HTML API）
- [x] 検索結果のパース・整形（タイトル、URL、スニペット）
- [x] レスポンスサイズ制限（上位5件、3,000文字以内）
- [x] リトライ実装（ネットワーク/5xx: 最大2回1秒、429: Exponential Backoff 2s→4s）

#### 21-2-2: URL 取得ツール

- [x] url_fetch ツール実装（`lib/tools/url-fetch.ts`）
- [x] HTML タグ除去・テキスト抽出処理
- [x] SSRF 防止（DNS解決後 IPv4/IPv6 ブロックリスト、IPv4-mapped IPv6 正規化、redirect: 'error'）
- [x] レスポンスサイズ制限（2MB入力、5,000文字出力）

#### 21-2-3: フロントエンド拡張

- [x] Web 検索結果のリッチ表示（リンク付き検索結果一覧、ToolCallResult に WebSearchResult サブコンポーネント追加）
- [x] URL 取得結果の表示改善

#### 21-2-4: E2E テスト（Phase B）

- [x] Web 検索ツール E2E テスト作成（agent-phase-b.spec.ts: 正常系/準正常系/異常系）
- [x] URL 取得ツール E2E テスト作成（正常系/準正常系/異常系）

### 21-3: Phase C — 自律エージェント化

#### 21-3-1: システムプロンプト設計

- [x] 自律思考を促すシステムプロンプト作成（調査→判断→再調査→まとめ）
- [x] システムプロンプトの設定 UI（設定モーダルでプリセット選択、Tools ON 時のみ表示）
- [x] プリセットプロンプト作成（リサーチャー、分析者、比較レビュアー、なし の4種）— `lib/agent-prompts.ts`

#### 21-3-2: 思考過程の可視化

- [x] AgentThinking コンポーネント実装（`features/chat/components/AgentThinking.tsx`）
- [x] thinking イベントのストリーミング対応（NDJSON に thinking type 追加）
- [x] 思考過程の折りたたみ UI（デフォルト展開、aria-expanded 対応）
- [x] `<think>` タグのストリーム跨ぎ検出（状態マシン `contentBuffer` + `inThinkBlock` 方式）

#### 21-3-3: エージェントループの強化

- [x] LLM の思考テキスト抽出（`<think>` タグ内容を thinking イベントとして送信）
- [x] 実行統計の表示（ラウンド数・所要時間 — done イベントの agentRounds/agentDurationMs）
- [x] systemPrompt をシステムメッセージとして先頭挿入
- [x] useChat の thinkingText 蓄積・done 時の metadata 最終確定（FIFO pendingToolArgs Map）

#### 21-3-4: E2E テスト（Phase C）

- [x] 自律エージェント E2E テスト作成（agent-phase-c.spec.ts: 正常系/準正常系/異常系）
- [x] 思考過程表示テスト（AgentThinking の表示・折りたたみ）
- [x] プリセット localStorage 永続化テスト

### 21-4: ドキュメント

- [x] `docs/09-agent-architecture.md` 最終更新（実装結果の反映）
- [x] 既存ドキュメント更新（requirements, architecture, API設計, testing, CLAUDE.md）

## フェーズ22: 開発ルールの拡充（`.claude/rules/`）

### 22-1: TypeScript 固有規約の明文化

- [x] `.claude/rules/typescript.md` 追加（type/interface の使い分け・型/定数の配置・any 禁止・enum 回避・`import type`・as/! 抑制）
- [x] CLAUDE.md ルールテーブルへ `typescript.md` 行を追加

### 22-2: GitHub issue 運用ルールの明文化

- [x] `.claude/rules/github-issue.md` 追加（ブランチと対で起票・`Closes #N` 自動クローズ・サブ issue・`docs/07-tasks.md` との関係）
- [x] CLAUDE.md ルールテーブルへ `github-issue.md` 行を追加

### 22-3: ドキュメント同期

- [x] `docs/04-development-rules.md` に新規ルールへの参照を追記

## フェーズ23: コードと `.claude/rules/` の乖離解消

親 issue: #70（`.claude/rules/` 11 ルールに対する照合で検出した乖離 15 件）

### 23-1: 挙動の不整合（バグ相当）

- [x] `MAX_MESSAGE_LENGTH` の 3 重定義を単一化し、メッセージ保存 API の長さ検証漏れを修正 — #71
  - [x] `MAX_TITLE_LENGTH` の未使用も解消（generate-title の切り詰め・会話作成時の検証に適用）
- [x] `/api/conversations/[id]/messages` に UUID 検証を追加し 400 契約を統一 — #72

### 23-2: 規約への追従（機械強制の追加を含む）

- [x] 型のみの import を `import type` に統一し ESLint で機械強制 — #73
  - [x] `verbatimModuleSyntax: true` を有効化（新規型エラーなしを確認）
- [x] `any` キャストを `Prisma.InputJsonObject` の型ガードで解消し、残るキャストに根拠コメントを付与 — #74
  - [x] `src/` から `any` と `eslint-disable no-explicit-any` が 0 件になったことを確認
- [x] `ThemeId` / `THEMES` を `types/theme.ts` へ昇格し `as const` + 型導出に揃える — #75
  - [x] `as ThemeId` アサーションを型ガード `isThemeId` で解消
  - [x] テーマ切替の E2E（`theme.spec.ts`）を新規追加（従来カバレッジ 0 件）

### 23-3: テスト

- [x] 3分類必須の欠落を解消（conversations IT の異常系・debug spec の扱い） — #76
  - [x] デバッグ用スクラッチ 2 件（`debug-console` / `debug-input`）を削除 → `tsc` エラーが 0 件になった
  - [x] `theme.spec.ts` の lint エラー（#85 で見落とし）を修正

### 23-4: ルール記述の修正

- [x] 実装と食い違っているルール記述を修正（error-handling / frontend / typescript / CLAUDE.md） — #77
  - [x] C-1: `error-handling.md` の統一エラーレスポンス節を実態（`{ error: string }` を各 route で直接組む）に修正
  - [x] C-2/C-3: `frontend.md` のサーバー/クライアント分離・ロジック分離を実態に修正
  - [x] C-4: `typescript.md` の `src/constants/` を前向き指針として明示
  - [x] C-5: `CLAUDE.md` の features 構成に constants/・types/ を反映
  - [x] A-7: `typescript.md` の漸進適用条項の対象を既存 `interface` 全体に拡大

### 23-5: 追加検出分
- [x] `generate-title` の独自デフォルトモデルを解消し、Ollama 接続を `lib/ollama.ts` に集約 — #80
  - [x] `chatOnce()`（非ストリーミング）を `ollama.ts` に追加し route の直接 fetch を廃止
  - [x] `features/*/types/` の `.gitkeep` のみの空ディレクトリを削除

## フェーズ24: CI 発火条件の最適化

- [x] `paths-ignore` を 3 ワークフローに追加し、ドキュメントのみの変更で CI を発火させないようにした
- [x] `.claude/rules/testing.md` に「CI の発火条件」節を追加（branch protection との相互作用の注意も記載）
- [x] `CLAUDE.md`・`docs/04`・`docs/06` に発火除外を明記

## フェーズ25: Prettier 整形と品質チェックの CI 機械強制

- [x] `pnpm format` の対象を `front/` 配下全体に拡大し、`.prettierignore` で除外を管理
- [x] 未整形 41 ファイルを `prettier --write .` で一括整形（整形のみの独立コミット）
- [x] `format:check` / `typecheck` スクリプトを追加
- [x] `quality` ワークフローを新設し `lint` / `format:check` / `typecheck` を CI で機械強制
  - CI に lint が無く、規約違反・型エラーを含む変更がマージされ得た状態を解消
- [x] `.git-blame-ignore-revs` に整形コミットを登録し、README に設定手順を記載
- [x] `CLAUDE.md` / `README.md` / `README.en.md` / `docs/04` / `docs/06` / `coding-standards.md` を同期

## フェーズ26: リポジトリ全体レビュー指摘の修正・CI 衛生

2026-07-31 のリポジトリ全体 Codex レビュー（#91〜#97）と CI 点検（#98〜#101）で検出した指摘。新機能（フェーズ12〜20）より先に消化する（順序は [10-roadmap.md](./10-roadmap.md) の Tier 0）。

### 26-1: P1 — データ消失・リソース枯渇・操作不能

- [x] メッセージ保存失敗を検知し、画面表示だけ残るサイレントデータ消失を防ぐ — #91
  - [x] `saveMessage()` で `response.ok` を検証し、失敗したメッセージに失敗表示と再試行ボタンを出す
  - [x] user メッセージの保存を待ってから LLM を呼ぶ（失敗時は呼ばず、再送で保存後に生成）
  - [x] タイトル生成を assistant 応答の保存成功後に限定
  - [x] 保存上限を role 別に分離（user 10,000 / assistant 100,000 文字。`MAX_ASSISTANT_MESSAGE_LENGTH`）
  - [x] メッセージ作成と会話 `updatedAt` 更新をトランザクション化（DB トリガーで障害注入する IT で検証）
- [x] `url_fetch` / `web_search` のレスポンス本文をストリーム制限し、無制限バッファと実行リークを防ぐ — #92
  - [x] `lib/tools/read-body.ts`（`readBodyWithLimit`）で本文をストリーム読み取りし、受信バイト数の上限超過・signal 中断で reader を cancel
  - [x] タイムアウトをヘッダー受信から本文の読了まで有効化（`AbortSignal.any` で期限とエージェントの中断を合流）
  - [x] `runTool()` から `Tool.execute(args, signal)` へ `AbortSignal` を伝播し、タイムアウト時に fetch・本文読み取り・リトライ待機を中断
  - [x] 上限をバイト単位で定義（`url_fetch` 2 MiB / `web_search` 1 MiB）。`Content-Length` は早期拒否の補助、早期 return 時は本文を cancel
  - [x] UT `read-body.test.ts`・IT `chat-agent.test.ts`（サイズ超過・偽装 Content-Length・タイムアウト中断・SSRF・中断後のリトライ停止の tool result）を追加
  - [x] `agent-phase-b.spec.ts` の SSRF / URL 異常系で NDJSON の tool result 内容を検証（LLM が対象 URL を取得した場合のみ）
- [x] モバイル表示でも会話履歴・新規会話・設定へアクセスできる導線を追加する — #93
  - [x] ヘッダーにモバイル用メニューボタン（`aria-expanded` / `aria-controls` / `aria-haspopup`）を追加
  - [x] サイドバーの中身を `SidebarContent` に切り出し、デスクトップの `Sidebar` とモバイルの `SidebarDrawer` で共有
  - [x] `useDrawerDialog` でフォーカス移動・フォーカストラップ・Escape・閉じた後のフォーカス復帰・背景スクロール固定・デスクトップ幅での自動クローズを実装
  - [x] 削除ボタンをドロワーでは常時表示し、デスクトップではキーボードフォーカス時にも表示（`aria-label` 付与）
  - [x] E2E `mobile-navigation.spec.ts` を追加し、`responsive.spec.ts` でメニューボタンの到達性を検証
  - [x] `screenshot.spec.ts` の `mobile-view` ベースラインを更新（メニューボタン追加後のヘッダー。旧画像は許容差 5% で通っていたが、文言・ヘッダーとも古かった）

### 26-2: P2 — API 契約・永続化の不整合

- [ ] Route Handler の JSON ボディを実行時検証し、不正な型を 400 で拒否する — #95
- [ ] 存在しない会話の DELETE を 500 ではなく 404 で返す — #97
- [ ] `thinkingText` とエージェント実行統計を `Message.metadata` に永続化する — #94
- [ ] エージェント最大ラウンド到達時に途中結果を捨てず最終回答へフォールバックする — #96

### 26-3: CI 衛生

- [x] 4 ワークフローの `pnpm install` に `--frozen-lockfile` を付け、lockfile のずれを CI で検出する — #98
  - [x] 現行 lockfile が `package.json` と整合していることを確認（frozen install が成功）
  - [x] `package.json` だけを変更した状態で `ERR_PNPM_OUTDATED_LOCKFILE` により失敗することを確認
- [ ] 4 ワークフローの衛生（permissions / concurrency / paths-ignore 重複）を是正し、actionlint を導入する — #99
- [ ] 鍵・`.env` の Git 混入を検出する Secret scan ジョブを追加する — #100
- [ ] Dependabot（github-actions）を導入し、Node 20 向けアクションを更新する — #101

### 26-4: 依存パッケージの脆弱性解消

- [x] Dependabot セキュリティアラート（npm）を一括解消する — #107
  - [x] `next` / `eslint-config-next` を 16.1.4 → 16.4.2 に更新（critical の RCE 2 件を含む）
  - [x] `vitest` を 4.1.12 に更新（`@vitest/mocker` のパストラバーサル）
  - [x] 現行メジャー内で全依存を更新し、推移依存（hono / undici / postcss / sharp / js-yaml 等）を解消
  - [x] `pnpm audit` の残り 1 件（`braces`：修正版未提供・`eslint-config-next` 経由の lint 時専用）は解消不能として記録

## フェーズ27: ローカル開発環境の負荷軽減・モデル更新

ローカル E2E で既定の大モデル（`qwen3-coder-next`、読み込み時約 58GB）が読み込まれ、64GB の Mac でメモリが逼迫した（2026-10-17）。

- [x] ローカル E2E の既定モデルを `qwen2.5:0.5b` にし、大モデルの意図しない読み込みを防ぐ — #110
  - [x] `tests/e2e/helpers/model.ts` に E2E のモデル解決を集約し、`playwright.config.ts` の `webServer.env` で dev サーバーの `OLLAMA_MODEL` に渡す（`E2E_OLLAMA_MODEL` で上書き可）
  - [x] `globalSetup` で、再利用した dev サーバーのモデル不一致・モデル未取得を検出して開始前に止める
  - [x] ツール呼び出し依存の E2E 5 件のスキップ条件を `process.env.CI` から `IS_LIGHT_MODEL` に変更
  - [x] `chat-loading.spec.ts` を、軽量モデルの速い応答でもローディング表示を取りこぼさないよう MutationObserver による監視に変更（10 回連続・リトライなしで全件成功）
  - [x] CI（`E2E_OLLAMA_MODEL`）・`Makefile`・`CLAUDE.md`・`README.md`・`README.en.md`・`docs/02`・`docs/04`・`docs/06`・`.claude/rules/testing.md`・`manuals/setup-guide-macos.md` を同期
- [x] 既存の E2E の不具合を直し、ツール呼び出し系のテストで新しいモデルを判定できるようにする — #115（#111 の前提）
  - [x] 応答の完了待ちを、入力欄が空だと有効にならない送信ボタン待ちから `waitForResponseComplete`（1 文字入力してから有効化を待つ）に変更（8 件）
  - [x] 保存失敗の表示が消えたかの判定を `role="status"` に絞り、dev オーバーレイの同じ文言に一致しないようにする（`conversation.spec.ts` 2 箇所）
  - [x] スクリーンショットの基準画像を 3 件追加し、送信時刻をマスクする。初回コミットのまま古くなっていた `initial-empty` を更新
  - [x] エージェント系 E2E が直接書いていた未取得モデル `qwen3-coder:latest` を `E2E_OLLAMA_MODEL` に置き換える
- [x] Ollama の `message.thinking` を思考過程として表示し、通常チャットの思考の扱いを決める — #116（#111 の前提）
  - [x] `lib/ollama.ts` の `streamChat()` / `chatOnce()` に `think` オプションを追加
  - [x] エージェントで `message.thinking` を 1 回の応答ごとにまとめて `thinking` イベントにする（`<think>` タグの解析は残す）
  - [x] 通常チャットとタイトル生成は `think: false`（`qwen3.8:27b` で最初の文字まで約 5.7 秒 → 約 0.4 秒）
  - [x] ラウンドごとの思考過程を空行で区切って表示する
- [ ] Ollama を 0.32 系へ更新し、既定モデルを Qwen3.8-27B へ移行できるか検証する — #111
- [ ] ESLint の除外にテスト成果物（`playwright-report` 等）を追加し、`.prettierignore` と範囲を揃える — #113
