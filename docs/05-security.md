# セキュリティ要件書

> 最終更新: 2026-06-11

## 目次

- [前提条件](#前提条件)
- [入力バリデーション](#入力バリデーション)
  - [チャットメッセージ](#チャットメッセージ)
  - [会話タイトル](#会話タイトル)
  - [APIリクエスト共通](#apiリクエスト共通)
- [XSS対策](#xss対策)
- [Content Security Policy（CSP）](#content-security-policycsp)
- [データベースセキュリティ](#データベースセキュリティ)
- [エラーハンドリング](#エラーハンドリング)
- [Rate Limiting](#rate-limiting)
- [環境変数の保護](#環境変数の保護)
- [Git管理から除外するファイル](#git管理から除外するファイル)
- [CORS設定](#cors設定)

## 前提条件

- **利用形態**: 個人利用（シングルユーザー）
- **公開範囲**: localhost限定（外部ネットワークからアクセスしない）
- **認証**: 不要（ログイン機能なし）

## 入力バリデーション

### チャットメッセージ

| 項目 | ルール |
|------|--------|
| 空入力 | 送信不可（フロントエンド + API両方でチェック） |
| 最大文字数 | 10,000文字（フロントエンド + API両方でチェック） |
| 前後の空白 | トリム処理を行う |

### 会話タイトル

| 項目 | ルール |
|------|--------|
| 空の場合 | 自動生成（最初のメッセージの先頭N文字等） |
| 最大文字数 | 100文字 |

### APIリクエスト共通

- リクエストボディのJSON形式チェック
- 必須フィールドの存在チェック
- 型チェック（文字列に数値が来ていないか等）
- UUIDフォーマットのバリデーション（会話ID、メッセージID）

## XSS対策

- Reactの標準エスケープ機能を活用する（`dangerouslySetInnerHTML` は使用禁止）
- ユーザー入力をそのままHTMLとしてレンダリングしない
- AIレスポンスのMarkdown表示には `react-markdown` + `remark-gfm` を使用
  - `react-markdown` はHTMLをパースせず、Markdownのみをリアクトコンポーネントに変換するため安全
  - `dangerouslySetInnerHTML` を使用しない方式でMarkdown整形を実現
  - カスタムコンポーネント（code, table, blockquote等）でNordテーマのスタイルを適用

## Content Security Policy（CSP）

Next.jsの設定で以下のCSPヘッダーを設定する:

```
default-src 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self';
connect-src 'self';
```

- `script-src` の `unsafe-inline` はNext.jsのSSR/RSCハイドレーション用インラインスクリプトに必要
- `script-src` の `unsafe-eval` はNext.js開発モード（HMR/React Refresh）に必要
- `style-src` の `unsafe-inline` はTailwindCSSのインラインスタイルに必要
- 外部CDNからのスクリプト・スタイル読み込みは禁止

## データベースセキュリティ

- **SQLインジェクション**: Prisma ORMを使用するため、パラメータ化クエリが自動適用される
- **カスケード削除**: 会話削除時に関連メッセージも自動削除（Prismaスキーマで定義済み）
- **接続情報**: `DATABASE_URL` は `.env.local` で管理し、Git管理対象外（`.gitignore`に含める）

## エラーハンドリング

- **クライアントへの返却**: エラー詳細を含めて返す（ローカル利用のため許容）
- **サーバーログ**: `console.error` で詳細なスタックトレースを出力
- **Ollama接続エラー**: 接続先のURL・ステータスコードを含むエラーメッセージを返す

## Rate Limiting

- **不要**（ローカル個人利用のため）

## 環境変数の保護

- `.env.local` を `.gitignore` に含める
- `DATABASE_URL`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL` をGitにコミットしない
- 環境変数のデフォルト値はコード内にハードコードしない（`lib/` 内の設定ファイルで管理）

## Git管理から除外するファイル

| パス | 理由 |
|------|------|
| `.env*` | 環境変数（DB接続情報等） |
| `.claude/` | Claude Code内部ファイル |
| `src/generated/prisma/` | Prisma自動生成クライアント（`prisma generate`で再生成） |
| `node_modules/` | 依存パッケージ |
| `.next/` | Next.jsビルド出力 |
| `test-results/` | テスト結果（スクリーンショット・トレース） |

## CORS設定

- ローカル利用のためCORS制限は不要
- Next.jsのデフォルト設定（同一オリジンのみ許可）を維持する
