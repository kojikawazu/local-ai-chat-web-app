# セキュリティ要件書

> 最終更新: 2026-10-25

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
  - [秘匿ファイルの混入検出（Secret scan）](#秘匿ファイルの混入検出secret-scan)
- [CORS設定](#cors設定)
- [ローカルの補助サービス（SearXNG）](#ローカルの補助サービスsearxng)

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
| AI応答の保存上限 | 100,000文字（保存 API でチェック。LLM 出力は長さを制御できないため入力上限と分ける） |
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
  - コードブロックのシンタックスハイライトは `rehype-highlight` で行う。構文木（hast）を書き換えるだけで HTML 文字列を作らないため、コード内の `<script>` 等は文字のまま表示される。色は CSS クラスで付け、インラインの `style` 属性も作らない
  - Mermaid の図（#169）は、mermaid が返す SVG の文字列を `data:image/svg+xml` の URI にして `<img>` で表示する。DOM に SVG を直接入れない（`innerHTML` / `dangerouslySetInnerHTML` を使わない）。画像としての SVG はスクリプト・イベント属性を実行せず、外部の資源も読み込まない。そのうえで mermaid の `securityLevel: 'strict'` でラベルを消毒し、`click` 文を無効にする。CSP は変えない（`img-src 'self' data:` で足りる）

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

### 秘匿ファイルの混入検出（Secret scan）

`.gitignore` は「混入させない」側の対策でしかない。以下の 2 つの性質があるため、CI に「追跡された時点で落とす」検出側を併せて持つ。

- **`.gitignore` は未追跡ファイルにしか効かない。** 一度追跡されたファイルには無視が効かず、`git add -f` や除外の書き漏れも止められない。
- **Git の履歴は追記型。** push 済みの秘匿ファイルは追跡を外しても履歴に残る。対処は履歴の書き換えではなく、含まれる鍵・トークンの**ローテーション**しかない。

`.github/workflows/secret-scan.yml` が `git ls-files` で追跡対象を検査し、該当があれば失敗する。どの変更でも混入しうるため、パスの絞り込みなしで常に実行する。

| 区分 | パターン |
|---|---|
| 検出（環境変数） | `.env`・`.env.local`・`.env.production` 等の `.env` 系 |
| 検出（鍵・認証情報） | `*.key`・`*.pem`・`*.p12`・`*.pfx`・`*.jks`・`*.keystore`・`id_rsa`・`id_ed25519`・`id_dsa`・`credentials.json`・`serviceAccountKey.json` |
| 除外 | `*.example`・`*.sample`・`*.template`・`*.dist`（テンプレート）、`*.env.d.ts`（型定義） |

検出されたら、ファイルを追跡から外すだけでなく、含まれる鍵・トークンを必ずローテーションする。

## CORS設定

- ローカル利用のためCORS制限は不要
- Next.jsのデフォルト設定（同一オリジンのみ許可）を維持する

## ローカルの補助サービス（SearXNG）

Web検索ツール（`web_search`）は、`docker-compose.yml` で起動するローカルの SearXNG を経由する（#151）。

- **この PC の中だけに公開する**: ポートは `127.0.0.1:8888` に限る。ローカル利用のため同時アクセスの制限（`limiter`）を止めており、外へ公開すると第三者の検索の中継に使われうる。
- **秘密鍵を置かない**: SearXNG は `server.secret_key` が既定値だと起動しない。`SEARXNG_SECRET` が空なら起動ごとにランダムな鍵を作り、リポジトリにも `.env` にも置かない（鍵は Cookie 等の署名にしか使わない）。
- **検索結果はデータとして扱う**: 検索結果のタイトル・概要は外部のページ由来のため、モデルへの指示として扱わない（プロンプトインジェクションの経路になりうる）。URL は http / https のものだけを採る。
