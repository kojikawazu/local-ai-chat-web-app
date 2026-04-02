# 要件定義書

## プロジェクト概要

ローカルLLM（Ollama）と対話できるチャットWebアプリケーション。
Nordic Frostデザインシステムをベースとした画面設計を採用する。

## 技術スタック

| 項目 | 技術 |
|------|------|
| フレームワーク | Next.js 16 (App Router) |
| 言語 | TypeScript 5 |
| React | React 19（React Compiler有効） |
| スタイリング | TailwindCSS 4 |
| アイコン | lucide-react |
| Markdown表示 | react-markdown + remark-gfm |
| パッケージマネージャー | pnpm |
| LLMバックエンド | Ollama |
| LLMモデル | qwen3-coder:latest（動的にモデル切替可能） |
| DB | PostgreSQL 16（Docker Compose） |
| ORM | Prisma 7 |
| E2Eテスト | Playwright |
| リンター | ESLint 9 |
| フォーマッター | Prettier |

## 機能要件

### 必須機能（MVP）

1. **チャット機能**
   - ユーザーがメッセージを入力し、Ollamaからの回答を受け取る
   - ストリーミングレスポンス対応（リアルタイムに1文字ずつ表示）
   - メッセージの送信（Enter / 送信ボタン）
   - Shift+Enterで改行
   - IME入力対応（日本語入力中のEnter確定で送信されない）

2. **画面構成**（`base/`のデザインを踏襲）
   - サイドバー：会話一覧、新規会話作成、設定ボタン
   - ヘッダー：モデル選択ドロップダウン
   - チャットエリア：メッセージ一覧、自動スクロール
   - 入力エリア：テキスト入力、送信ボタン
   - フッター：システム情報

3. **Ollama連携**
   - Next.js Route Handlers経由でOllama APIと通信
   - ストリーミング（Server-Sent Events / ReadableStream）対応
   - 接続先は環境変数で設定可能（ローカルのみ想定）
   - 利用可能モデル一覧の動的取得

4. **会話履歴の永続化**
   - PostgreSQLに会話・メッセージを保存
   - 会話単位でグループ化し、サイドバーに一覧表示
   - 会話の新規作成・選択・切り替え

### 追加機能

5. **モデル選択**
   - Ollamaの利用可能モデル一覧をAPI経由で取得
   - ヘッダーのドロップダウンからモデルを切り替え
   - 設定画面からもモデル変更可能

6. **設定画面**
   - モーダルダイアログで設定を表示
   - モデル選択
   - テーマ切替

7. **マークダウン表示**
   - AIレスポンスのMarkdownをリッチに整形表示
   - コードブロック（シンタックスハイライト風スタイリング）
   - テーブル、リスト、引用、リンク等のサポート
   - react-markdown + remark-gfm を使用

8. **会話タイトル自動生成**
   - 新規会話の最初のメッセージ送信後、LLMでタイトルを自動生成
   - 日本語で20文字以内の簡潔なタイトル
   - サイドバーの会話一覧に反映

9. **テーマ切替**
   - 3種類のテーマを用意
     - Nordic Frost（デフォルト）：北欧ブルー
     - Aurora Borealis：紫とシアンのオーロラ
     - Midnight Ocean：深海ブルーのダーク
   - CSS変数ベースのテーマシステム（`data-theme`属性で切替）
   - localStorageに選択テーマを永続化
   - 設定画面から切替可能

10. **エージェント機能（ツール呼び出し）**
   - エージェントモード ON/OFF トグル（設定モーダル）、localStorage 永続化
   - 利用可能ツール: get_current_datetime, calculate, web_search, url_fetch
   - ツール実行中インジケーター表示（ToolCallIndicator）
   - ツール実行結果の折りたたみ表示（ToolCallResult）
   - Web 検索結果のリッチ表示（リンク付き）
   - 思考過程の表示（AgentThinking — `<think>` タグ対応モデルで動作）
   - システムプロンプトプリセット選択（リサーチャー / 分析者 / 比較レビュアー / なし）
   - 実行統計表示（ラウンド数・所要時間）
   - SSRF 防止（DNS 解決後 IP ブロックリスト、redirect: 'error'）

## 非機能要件

- ローカル環境で動作すること
- レスポンシブデザイン対応（base/のデザインに準拠）
- PostgreSQLはDocker Composeで管理
- **CI/CD**: GitHub Actionsで E2E テストを自動実行（push/PR to main）
- **ドキュメント**: macOS向けセットアップガイドを提供（`manuals/setup-guide-macos.md`）

## セキュリティ要件

- **認証**: 不要（localhost個人利用）
- **公開範囲**: localhost限定
- **入力バリデーション**: 厳格（XSS防止、CSPヘッダー設定、入力パターン検証）
- **メッセージ最大文字数**: 10,000文字（フロントエンド + API両方でチェック）
- **Rate Limiting**: 不要
- **エラー情報**: 詳細をクライアントに返す（ローカル利用のため許容）
- **`dangerouslySetInnerHTML` 使用禁止**
- 詳細は `docs/05-security.md` を参照

## 画面設計リファレンス

`base/` ディレクトリ内のViteプロジェクトがUIデザインリファレンスとして存在する。
Nordic Frostテーマ（Nord配色）のレイアウト・配色を踏襲して開発する。

### 参照ファイル

- `base/themes.ts` — 配色定義（ThemeStyles型）
- `base/App.tsx` — 全体レイアウト構成
- `base/components/` — 各UIコンポーネントの実装参考
