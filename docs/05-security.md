# セキュリティ要件書

> 最終更新: 2026-10-26

## 目次

- [前提条件](#前提条件)
- [入力バリデーション](#入力バリデーション)
  - [チャットメッセージ](#チャットメッセージ)
  - [会話タイトル](#会話タイトル)
  - [添付画像](#添付画像)
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
- [ローカルの補助サービス（SearXNG・PlantUML）](#ローカルの補助サービスsearxngplantuml)
- [ローカルのファイルのツール](#ローカルのファイルのツール)

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

### 添付画像

#6。設計は [13-image-attachment.md](./13-image-attachment.md) の「セキュリティ」。

| 項目 | ルール |
|------|--------|
| 形式 | PNG / JPEG のみ。**クライアントの申告を使わず、サーバーが中身の先頭（マジックナンバー）で判定する**（`lib/server/attachment.ts`）。SVG（スクリプトを含みうる）・GIF・WebP 等は 400 |
| 枚数 | 1 メッセージ 4 枚まで（保存 API・`/api/chat` でチェック） |
| 大きさ | 1 枚 5MB まで（Base64 を復号する前に長さから判定する）。幅・高さは 1〜1,280px |
| 添付できる role | user のみ（assistant の添付は 400） |
| 配信 | `GET /api/attachments/[id]` は保存した形式の `Content-Type` と `X-Content-Type-Options: nosniff` で返し、ブラウザに形式を推測させない |
| 位置情報（EXIF） | ブラウザで再エンコード（`<canvas>` に描き直す）して落としてから送る（`lib/chat/image-attachment.ts`） |
| 会話の境界 | 添付の取得 API と `/api/chat` の `imageIds` は、添付がどの会話のものかを確かめない。認証なしの localhost 個人利用で会話の境界に意味が無く、ID は推測しにくい UUID のため |

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

## ローカルの補助サービス（SearXNG・PlantUML）

Web検索ツール（`web_search`）は、`docker-compose.yml` で起動するローカルの SearXNG を経由する（#151）。

- **この PC の中だけに公開する**: ポートは `127.0.0.1:8888` に限る。ローカル利用のため同時アクセスの制限（`limiter`）を止めており、外へ公開すると第三者の検索の中継に使われうる。
- **秘密鍵を置かない**: SearXNG は `server.secret_key` が既定値だと起動しない。`SEARXNG_SECRET` が空なら起動ごとにランダムな鍵を作り、リポジトリにも `.env` にも置かない（鍵は Cookie 等の署名にしか使わない）。
- **検索結果はデータとして扱う**: 検索結果のタイトル・概要は外部のページ由来のため、モデルへの指示として扱わない（プロンプトインジェクションの経路になりうる）。URL は http / https のものだけを採る。

応答の PlantUML の図は、`docker-compose.yml` で起動するローカルの PlantUML サーバーで描く（#171）。

- **外部の URL・ファイルを読ませない**: PlantUML の既定の設定では、`!include https://…` でサーバーが外部の URL を取りに行く（実測）。応答の本文はモデルが書いたもので、Web 検索・URL 取得の結果に紛れた指示から作られることもあるため、`PLANTUML_SECURITY_PROFILE=SANDBOX` で URL・ファイルの読み込みを止める（同梱の標準ライブラリは使える）。CI の E2E の `services:` も同じ設定にする。
- **この PC の中だけに公開する**: ポートは `127.0.0.1:8889` に限る。
- **ブラウザから直接つながない**: `/api/diagrams/plantuml` を経由し、返った SVG は data: URI の `<img>` で表示する（DOM に入れない）。ソースは 50,000 文字（`MAX_DIAGRAM_SOURCE_LENGTH`）までに制限し、10 秒で打ち切る。

## ローカルのファイルのツール

エージェントの `list_directory`・`search_files`・`read_file`（#148）は、ローカル PC のファイルを読む。ツールを呼ぶ判断はモデルがし、モデルは Web の結果や読んだファイルに書かれた指示にも従いうる（プロンプトインジェクション）ため、次の制限をツールの側で持つ（設計は `docs/14-local-file-tools.md`）。

| 脅威 | 対策 |
|---|---|
| 許可していない場所を読む | 環境変数 `LOCAL_FILE_ROOTS` で読んでよいフォルダを明示する。**未設定ならツールを登録しない**。パスは `realpath` で実体にしてから `path.relative` で包含を判定し（`..`・シンボリックリンクで外へ出られない）、検索ではシンボリックリンクをたどらない |
| 秘匿ファイルを読む | `.env`（テンプレートを除く）・鍵・認証情報のファイルと、`.ssh`・`.gnupg`・`.aws`・`.kube`・`.docker` のフォルダは、一覧・検索に出さず読み取りも断る。名前の範囲は Secret scan（上の表）と同じ |
| 読んだ中身を外へ送る | 同じ応答の中でローカルのファイルを読むツールが成功した後は、`web_search`・`url_fetch` を実行しない（`agent.ts` の `shouldBlockTool`）。次の質問では使える。応答の本文に引用された中身は履歴に残るため、完全な遮断ではない |
| 大きなファイル・フォルダで止まる | 1 回の読み取りは 300 行・12,000 文字、開くファイルは 2MB まで。検索は 30 件・5,000 ファイル・1 ファイル 1MB まで、`node_modules`・`.git` などはたどらない。どれも `AGENT_TOOL_TIMEOUT_MS` で止まる |
| 書き換え・実行 | 読み取りだけで、書き込み・実行の手段を持たない（書き込み・実行は #148 の後の段階で、承認の UI と合わせて設計する） |

- `LOCAL_FILE_ROOTS` には、プロジェクトのフォルダなど必要な範囲だけを指定する（ホーム全体を指定すると、上の秘匿ファイル以外の個人のファイルも読める）。
- E2E の dev サーバーには、開発者の値ではなく E2E 用のフォルダ（`tests/e2e/fixtures/local-files/`）だけを渡す。

