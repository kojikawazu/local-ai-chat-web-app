# タスク一覧

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
- ※ GET /api/tools は未実装（設定 UI で直接プリセット選択方式に変更）

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
