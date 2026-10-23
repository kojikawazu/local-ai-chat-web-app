# テスト要件書

> 最終更新: 2026-10-24

## 目次

- [基本方針](#基本方針)
- [3分類ルール（必須）](#3分類ルール必須)
- [テストシナリオ](#テストシナリオ)
  - [チャット機能](#チャット機能)
  - [サイドバー操作](#サイドバー操作)
  - [会話履歴の永続化](#会話履歴の永続化)
  - [ストリーミング表示](#ストリーミング表示)
  - [セキュリティ](#セキュリティ)
  - [レスポンシブ・画面表示](#レスポンシブ画面表示)
  - [モバイルナビゲーション](#モバイルナビゲーション)
  - [モデル選択](#モデル選択)
  - [設定画面](#設定画面)
  - [マークダウン表示](#マークダウン表示)
  - [テーマ切替](#テーマ切替)
- [スクリーンショットテスト（ビジュアルリグレッション）](#スクリーンショットテストビジュアルリグレッション)
  - [対象画面](#対象画面)
  - [運用ルール](#運用ルール)
- [テストデータ管理](#テストデータ管理)
- [失敗時レポート](#失敗時レポート)
  - [Playwright設定（抜粋）](#playwright設定抜粋)
  - [E2E のモデル](#e2e-のモデル)
- [テストファイル構成](#テストファイル構成)
  - [テストヘルパー（test-data.ts）](#テストヘルパーtest-datats)
- [CI（GitHub Actions）](#cigithub-actions)
  - [トリガー](#トリガー)
  - [実行環境](#実行環境)
  - [ワークフロー概要](#ワークフロー概要)
  - [CIスキップ対象テスト](#ciスキップ対象テスト)
  - [CI固有の技術的考慮事項](#ci固有の技術的考慮事項)

## 基本方針

- **3層構成**: ユニット（UT / Vitest）+ インテグレーション（IT / Vitest + Testcontainers）+ E2E（Playwright）。
  - **UT**: 外部I/O非依存の純ロジックを対象（`lib/validation.ts`・`lib/tools/calculate.ts`・`lib/agent-prompts.ts` 等）。外部I/O（fetch/DB）のみモックし、ビジネスロジックはモックしない。UIコンポーネント単位のユニットテストは実施しない（E2Eで担保）。
  - **IT**: route handler をブラウザ抜きで直接叩き、実PostgreSQL（Testcontainers）相手に handler↔Prisma↔DB を検証。実依存（DB）は使い、mockは真の外部3rd-party（Ollama/Web）のみ。
  - **E2E**: 実際のOllama + PostgreSQLに接続してテストする（実環境・ブラウザ経由）。
- **エラーハンドリングの層分担**: APIのエラー**契約**（Ollamaダウン→502・バリデーション→4xx）はITで決定的に検証。エラー時のUI**描画・耐性**はE2Eで検証し、境界の障害注入を唯一の許容mock例外とする。対象は通信の境界（`page.route`）と、実ブラウザで安定して起こせないブラウザ API の境界（`page.addInitScript` で `navigator.clipboard` / `document.execCommand` を差し替える等。`copy.spec.ts`）に限り、アプリ側のロジックは差し替えない。
- **ブラウザ**（E2E）: Chromiumのみ。
- **CI**: GitHub Actionsで自動実行（品質チェック・UT・IT・E2Eは独立ジョブ。ワークフロー定義は Workflow Lint、秘匿ファイルの追跡は Secret scan が常時検査）。

### ユニットテスト（Vitest）

| 項目 | 内容 |
|------|------|
| ランナー | Vitest（`environment: node`） |
| 配置 | `front/tests/unit/`（`*.test.ts`） |
| 設定 | `front/vitest.config.ts`（`tests/unit/**` のみ対象・`@/*` エイリアス解決） |
| 実行 | `pnpm test:unit`（監視: `pnpm test:unit:watch`） |
| 対象（初期） | `isValidUUID`（validation）・`calculateTool`（式評価パーサー）・`getPresetById`（プリセット探索） |
| モック | 外部I/Oのみ。初期対象は純関数のため mock なし |

### インテグレーションテスト（Vitest + Testcontainers）

| 項目 | 内容 |
|------|------|
| ランナー | Vitest（`environment: node`）+ `@testcontainers/postgresql` |
| 配置 | `front/tests/integration/`（`*.test.ts`） |
| 設定 | `front/vitest.integration.config.ts`・`front/tests/integration/helpers/`（global-setup: コンテナ起動＋`migrate deploy`、setup-env: 接続URL注入） |
| 実行 | `pnpm test:integration` |
| 対象 | DB系: `/api/conversations`（作成/一覧）・`[id]`（削除・cascade）・`[id]/messages`（保存/取得）・`[id]/messages/[messageId]`（置き換え）。外部系: `/api/chat`・`/api/models`（Ollamaをfetchスタブ） |
| 実依存 | PostgreSQL を Testcontainers で使い捨て起動（開発DBに触れない） |
| モック | 真の外部3rd-party（Ollama/Web）のみ手製fetchスタブ（`helpers/ollama-stub.ts`）。DB系はスタブ無し |
| エラー契約 | Ollamaダウン→502・バリデーション→400 等を IT で決定的に検証（E2E の障害注入から移譲） |
| 前提 | 生成クライアント（`src/generated/prisma/`）は gitignore のため `pnpm prisma generate` が必要。Docker が必要。CI の `integration-test` ジョブは Node 22（testcontainers が使う undici の `markAsUncloneable` は undici 6 系＝Node 22+ で追加された API のため） |

UT・IT・E2E とも **正常系・準正常系・異常系の3分類**で記述する。

## 3分類ルール（必須）

**全テストファイルに正常系・準正常系・異常系の3分類を必ず含めること。**

各テストファイル内で `describe` ブロックを以下のように分割する:

```typescript
describe('機能名', () => {
  describe('正常系', () => { ... });
  describe('準正常系', () => { ... });
  describe('異常系', () => { ... });
});
```

| 分類 | 定義 | 例 |
|------|------|-----|
| 正常系 | 期待通りの入力で期待通りの動作が行われる | メッセージ送信→応答表示 |
| 準正常系 | 許容される範囲だが境界的な入力・状態での動作 | 最大文字数ちょうど、空白のみ、0件状態、特殊文字 |
| 異常系 | 不正な入力・障害発生時のエラーハンドリング | 空入力拒否、接続エラー、存在しないID |

## テストシナリオ

### チャット機能

**正常系**
- メッセージを入力して送信ボタンで送信できる
- Enterキーで送信できる
- Shift+Enterで改行できる
- ストリーミングでAI応答がリアルタイムに表示される
- AI応答の内容が空でないことを検証する
- ストリーミング完了後、完全なメッセージが表示される
- メッセージ送信後、チャットエリアが自動スクロールする
- 日本語IME入力中のEnter確定で送信されない（compositionstart/end対応）

**準正常系**
- 最大文字数（10,000文字）ちょうどのメッセージを送信できる
- 前後に空白があるメッセージがトリムされて送信される

**異常系**
- 空のメッセージは送信できない（送信ボタンが無効化される）
- 10,000文字を超えるメッセージは送信できない
- Ollama接続エラー時にエラーメッセージが表示される

### サイドバー操作

**正常系**
- 新規会話を作成できる
- 会話一覧が表示される
- 会話を選択して切り替えできる
- 会話を削除できる

**準正常系**
- 会話が0件のときに適切な表示がされる
- 別タブ等で既に削除された会話を削除すると、削除 API が 404 を返しても一覧から消える（#97）

**異常系**
- 存在しない会話IDへのアクセス時にエラーが表示される
- 削除 API がサーバーエラー（500）を返すと、会話を一覧に残す

### 会話履歴の永続化

**正常系**
- 送信したメッセージがDBに保存される
- AI応答がDBに保存される
- ページリロード後も会話履歴が保持される
- 会話を切り替えると対応するメッセージが表示される

**準正常系**
- 長文メッセージ（10,000文字）が正しくDB保存・表示される
- 会話タイトルが未指定の場合、自動生成される

**異常系**
- DB接続エラー時にエラーメッセージが表示される
- 削除済み会話のメッセージ取得時にエラーが表示される
- 存在しない UUID の会話を削除すると 404 が返る（#97）
- ユーザーメッセージの保存に失敗すると「送信に失敗しました」を表示し、LLM を呼ばない。再送で保存・応答生成が進む
- AI応答の保存に失敗すると応答を残したまま「保存に失敗しました」を表示し、再試行で保存される（CI スキップ）

**エージェント応答の付随情報（`agent-metadata.spec.ts`、#94）**
- 正常系: 保存済みの応答を開くと、思考過程・ツール結果・ラウンド数・所要時間が表示される。エージェントの応答を再読み込みしても、ラウンド数（と、出ていれば思考過程）が表示される（CI スキップ）
- 準正常系: ツール呼び出しが無く思考過程だけの応答も復元される
- 異常系: metadata の不正な項目は表示せず、残りの項目と本文は表示する

### ストリーミング表示

**正常系**
- ストリーミングでAI応答がリアルタイムに表示される
- AI応答の内容が空でないことを検証する
- ストリーミング完了後、完全なメッセージが表示される

**準正常系**
- 短い応答（1〜2単語）が正しく表示される
- 応答に特殊文字・コードブロックが含まれる場合でも正しく表示される

**異常系**
- ストリーミング中にOllama接続が切断された場合、エラーが表示される
- Ollamaから空レスポンスが返った場合の処理

### セキュリティ

**正常系**
- 通常のテキストメッセージが正常に送信・表示される

**準正常系**
- HTMLタグを含むメッセージ（`<b>bold</b>`）がエスケープされて表示される
- 特殊文字（`& < > " '`）が正しくエスケープされる

**異常系**
- XSSパターン（`<script>alert('xss')</script>`）が入力された場合、スクリプトが実行されない
- 10,001文字以上の入力がフロントエンドで制限される
- SQLインジェクションパターンが入力されても安全に処理される

### レスポンシブ・画面表示

**正常系**
- デスクトップ表示でレイアウトが正しい
- サイドバーの開閉が正しく動作する

**準正常系**
- ウィンドウサイズを変更した際にレイアウトが追従する
- 非常に長いメッセージでもレイアウトが崩れない

**異常系**
- 極端に狭いビューポート（320px幅）でもクラッシュしない
- モバイル表示で操作不能な要素がない

### モバイルナビゲーション

`mobile-navigation.spec.ts`（375px 幅。ヘッダーのメニューボタン → サイドバードロワー）

**正常系**
- 履歴を開いて会話を切り替えられる（選択するとドロワーが閉じる）
- 新規会話に移れる（入力欄へフォーカスが移る）
- 会話を削除できる（hover なしで削除ボタンが見え、ドロワーは開いたまま）
- 設定を開き、テーマと Agent Tools を変更できる

**準正常系**
- `aria-expanded` / `aria-controls` / `aria-modal` で開閉状態を示し、Escape で閉じるとフォーカスがメニューボタンへ戻る
- Tab / Shift+Tab を繰り返してもフォーカスがドロワーの外へ出ない
- 背景のクリックで閉じる
- 開いている間は背景のスクロールを止め、閉じると戻す

**異常系**
- 320px 幅でヘッダーとドロワーの操作がビューポート内に収まる
- 開いたままデスクトップ幅へ広げると閉じ、スクロールの固定も解除される
- 会話が 0 件でもドロワーが開き、設定へ進める

### モデル選択

**正常系**
- ヘッダーのドロップダウンに利用可能なモデル一覧が表示される
- モデルを切り替えて新しいモデルでチャットできる

**準正常系**
- Ollamaに複数モデルがインストールされている場合、全て表示される

**異常系**
- Ollama接続エラー時にデフォルトモデルがフォールバック表示される

### 設定画面

**正常系**
- 設定ボタンをクリックで設定モーダルが開く
- モーダルからモデルを変更できる
- モーダルからテーマを変更できる
- Closeボタンまたはオーバーレイクリックでモーダルが閉じる

**準正常系**
- モデル一覧が空の場合、現在のモデルが表示される

**異常系**
- モーダル外クリックで意図しない操作が発生しない

### マークダウン表示

**正常系**
- AIレスポンスのコードブロックが整形表示される
- テーブル、リスト、引用が正しくレンダリングされる
- リンクが正しく表示される

**準正常系**
- 不完全なMarkdown構文でもクラッシュしない

**異常系**
- Markdown内のHTMLタグがスクリプト実行されない

### テーマ切替

**正常系**
- 設定画面からテーマを切り替えると即座に画面に反映される
- テーマ選択がlocalStorageに保存される
- ページリロード後もテーマが維持される

**準正常系**
- 3種類のテーマ全てで画面レイアウトが正常に表示される

**異常系**
- localStorageに不正なテーマIDが保存されている場合、デフォルト（nordic）にフォールバックする

## スクリーンショットテスト（ビジュアルリグレッション）

可能な画面に対してスクリーンショット比較を行う。

### 対象画面

- 初期表示（会話なし状態）
- チャット中（メッセージ複数件表示）
- サイドバー展開時
- エラー表示時
- モバイル表示

### 運用ルール

- ベースラインスクリーンショットは `front/tests/e2e/screenshot.spec.ts-snapshots/` に保存（macOS 用。CI では実行しない）
- デザイン変更時はベースラインを更新する（`pnpm test:e2e tests/e2e/screenshot.spec.ts --update-snapshots=all`）
  - 既定の `--update-snapshots`（`changed`）は許容差（`maxDiffPixelRatio: 0.05`）内の差分では更新しない。文言の変更程度では基準画像が古いまま成功し続けるため、デザインを変えたら `=all` で更新する
- 実行時刻で変わる表示（メッセージの送信時刻）は `mask` で隠す。AI の応答は使わず、DB に投入したメッセージや `page.route` で作ったエラーを撮る

## テストデータ管理

- **セットアップ/クリーンアップ単位**: テストスイート（ファイル）単位
- 各テストスイートの `beforeAll` でテストデータを投入
- 各テストスイートの `afterAll` でテストデータをクリーンアップ
- テスト間の依存関係を排除し、独立して実行可能にする

## 失敗時レポート

- **スクリーンショット**: テスト失敗時に画面キャプチャを自動保存
- **トレース**: Playwright Traceを有効化し、失敗時のネットワーク・操作ログを記録
- 出力先: `test-results/`

### Playwright設定（抜粋）

```typescript
// playwright.config.ts
{
  globalSetup: './tests/e2e/helpers/global-setup.ts',
  use: {
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  retries: 1,
  webServer: {
    command: 'pnpm dev',
    env: { OLLAMA_MODEL: E2E_OLLAMA_MODEL }, // 既定 qwen2.5:0.5b
  },
}
```

### E2E のモデル

E2E は**ローカル・CI ともに軽量モデル `qwen2.5:0.5b`** で実行する（#110）。以前のアプリ既定 `qwen3-coder-next`（読み込み時約 58GB）を E2E で読み込むと、64GB の Mac でメモリが逼迫し、他のアプリ（ブラウザの音声再生など）に影響が出たため。現在の既定 `qwen3.8:27b`（約 17GB、#111）でも E2E のたびに読み込むには重いため、軽量モデルのままとする。

| 項目 | 内容 |
|------|------|
| 定義 | `tests/e2e/helpers/model.ts`（`E2E_OLLAMA_MODEL` / `E2E_LIGHT_MODEL` / `IS_LIGHT_MODEL`） |
| 上書き | `E2E_OLLAMA_MODEL=qwen3.8:27b pnpm test:e2e`（大モデルで全件） |
| 渡し方 | `webServer.env` で dev サーバーの `OLLAMA_MODEL` に設定。Next.js は既存の環境変数を `.env.local` で上書きしないため、こちらが優先される |
| 事前準備 | `ollama pull qwen2.5:0.5b` |
| 開始前の検証 | `global-setup.ts` が `/api/models` を確認し、再利用した dev サーバーのモデルが異なる・モデル未取得なら開始前に止める（502 なら検証を省略） |
| 軽量モデルでのスキップ | ツール呼び出しに依存するテスト（`agent.spec.ts` 3 件・`agent-phase-c.spec.ts` 2 件）は `IS_LIGHT_MODEL` でスキップ |
| 応答の完了待ち | `waitForResponseComplete`（`helpers/test-data.ts`）を使う。送信ボタンは入力欄が空だと有効にならないため、1 文字入力してから有効化を待つ（#115）。ローディング表示は最初のチャンクまでしか出ないので完了の判定には使えない |
| 一瞬の状態の検証 | 軽量モデル（GPU）は応答が速く、ローディング表示が数十 ms で消える。送信後に待ち始める・Playwright のポーリングで待つと取りこぼすため、`chat-loading.spec.ts` は送信前に MutationObserver で監視を始める（`watchLoadingIndicator`） |
| 長い応答が必要な検証 | 軽量モデルは指示どおり長く答えるとは限らない。`helpers/long-answer.ts`（`streaming-stop.spec.ts`・`regenerate.spec.ts` が使う）は長くなりやすいプロンプト（日本の歴史を各時代について）を使い、止める前に終わったら送り直す（最大 3 回） |
| `page.route` で遅らせたリクエスト | 遅らせた後の `route.continue()` は、ページが中断した後でもサーバーへ転送する。受け手のいない生成が Ollama を占有して後続のテストを数分待たせたため、中断させるリクエストは転送せず `route.fulfill()` で返す（#8） |

## テストファイル構成

```
front/tests/
├── unit/                         # ユニットテスト（Vitest）
│   ├── validation.test.ts        # isValidUUID・入力上限定数
│   ├── request-body.test.ts      # JSON ボディの実行時検証（非オブジェクト・型不正・履歴の上限）
│   ├── conversation-history.test.ts # 会話履歴の組み立て（失敗した user の除外・件数／長さの上限）
│   ├── regenerate.test.ts        # 再生成できる応答の判定（最後・保存済み）と送り直す質問・履歴
│   ├── calculate.test.ts         # calculateTool 式評価パーサー
│   ├── read-body.test.ts         # 本文のバイト上限付きストリーム読み取り・中断
│   ├── web-search.test.ts        # SearXNG の応答の整形（上位 5 件・0 件と失敗の区別・不正な形）
│   ├── agent-prompts.test.ts     # getPresetById・プリセット不変条件
│   ├── agent-config.test.ts      # エージェント設定の環境変数の検証（NaN・0・負数・小数・範囲外は既定値へ）
│   ├── message-metadata.test.ts  # metadata の組み立て・取得時の実行時検証
│   ├── clipboard.test.ts         # コピー手段の選択（Clipboard API → 代わりのコピー）と失敗の判定
│   ├── code-block.test.ts        # コードブロックの言語名の取り出し（hljs 付き・未登録の言語・指定なし）と本文の連結
│   └── system-prompt.test.ts     # 役割とエージェントのプリセットの連結・表示名の逆引き・上限の不変条件・system メッセージの付与
├── integration/                  # インテグレーションテスト（Vitest + Testcontainers）
│   ├── helpers/
│   │   ├── global-setup.ts       # 使い捨てPostgreSQL起動 + migrate deploy
│   │   ├── setup-env.ts          # 接続URLを DATABASE_URL に注入
│   │   └── db.ts                 # resetDb・NextRequest/コンテキスト構築
│   ├── conversations.test.ts     # 作成/一覧（POST/GET）
│   ├── conversation-delete.test.ts # 削除・cascade・UUID/404/500
│   ├── conversation-update.test.ts # 会話の役割の変更（保存・外す・他フィールドは変えない・400/404/500）
│   ├── messages.test.ts          # メッセージ保存/取得・バリデーション・role 別上限・トランザクション・クライアント採番の id（重複は 409）
│   ├── message-replace.test.ts   # 応答の置き換え（再生成）・対象の制限（同じ会話の assistant のみ）・metadata の消去・ロールバック
│   ├── chat.test.ts              # /api/chat（Ollama fetchスタブ・502契約・400）
│   ├── chat-agent.test.ts        # /api/chat エージェント経路（url_fetch / web_search のサイズ超過・タイムアウト中断・SSRF・リトライ停止・SearXNG の未起動 / 403 / 応答しない検索エンジン）
│   ├── chat-agent-max-rounds.test.ts # /api/chat エージェントの最大ラウンド到達（ツールなしの最終回答・注記・失敗時もツール結果を残す）
│   ├── chat-stop.test.ts         # /api/chat の生成停止（cancel・request.signal で Ollama の接続を切る・エージェントのツール中断と次ラウンド停止・499）
│   ├── models.test.ts            # /api/models（Ollama fetchスタブ・502契約）
│   └── generate-title.test.ts    # タイトル自動生成（モデル解決の正準性・切り詰め・500契約）
└── e2e/
    ├── helpers/
    │   ├── test-data.ts          # テストデータ管理ヘルパー（CRUD・入力支援）
    │   ├── long-answer.ts        # 長い応答を生成中にする（停止・再生成の検証用）
    │   ├── model.ts              # E2E のモデル解決（E2E_OLLAMA_MODEL・軽量モデル判定）
    │   └── global-setup.ts       # 開始前に dev サーバーのモデル・モデル取得済みを検証
    ├── chat.spec.ts              # チャット機能テスト
    ├── chat-streaming.spec.ts    # ストリーミング表示テスト
    ├── chat-loading.spec.ts      # ローディング表示テスト
    ├── copy.spec.ts              # 応答・コードブロックのコピー・結果表示・代わりのコピー・失敗表示
    ├── system-prompt.spec.ts     # 会話の役割（新規会話での保存と送信への付与・既存会話の変更・役割なし・キャンセル/Escape・新規会話で持ち越さない・エージェントでの連結・保存失敗・上限）
    ├── syntax-highlight.spec.ts  # シンタックスハイライト（テーマ変数の色・テーマ追従・言語指定なし・未登録の言語・インラインコード・HTML タグの非実行・閉じていないフェンス）
    ├── streaming-stop.spec.ts    # 生成の停止（Stop ボタン・Escape・本文前の停止・中断した応答の保存と保存失敗）
    ├── regenerate.spec.ts        # 応答の再生成（置き換えと永続化・最後の応答のみ・本文前の停止と生成失敗で旧応答へ復元・生成中は無効・置き換えの保存失敗と再試行）
    ├── sidebar.spec.ts           # サイドバー操作テスト
    ├── conversation.spec.ts      # 会話管理テスト（CRUD・永続化）
    ├── security.spec.ts          # セキュリティテスト（XSS・文字数制限）
    ├── responsive.spec.ts        # レスポンシブ・レイアウトテスト
    ├── mobile-navigation.spec.ts # モバイルのドロワー（会話の切替・新規・削除・設定、aria・フォーカス・Escape）
    ├── theme.spec.ts             # テーマ切替・localStorage永続化テスト
    ├── agent.spec.ts             # エージェント基盤テスト（Phase A）
    ├── agent-phase-b.spec.ts     # 調査系ツールテスト（Phase B: web_search / url_fetch）
    ├── agent-phase-c.spec.ts     # 自律エージェントテスト（Phase C: 思考過程・プリセット）
    ├── agent-metadata.spec.ts    # エージェント応答の付随情報（思考過程・ツール結果・ラウンド数・所要時間）の復元
    ├── screenshot.spec.ts        # スクリーンショットテスト（CIスキップ）
    └── screenshot.spec.ts-snapshots/ # ベースラインスナップショット（OS別）
```

### テストヘルパー（test-data.ts）

| 関数 | 用途 |
|------|------|
| `fillTextarea(page, text)` | React controlled input にテキスト設定（短文: `pressSequentially`、長文: `nativeInputValueSetter`） |
| `sendMessage(page, text)` | テキスト入力 + Enter送信 |
| `createConversation(request, title)` | API経由で会話作成 |
| `createMessage(request, id, role, content)` | API経由でメッセージ作成 |
| `cleanupAllConversations(request)` | 全会話削除 |

## CI（GitHub Actions）

### トリガー

- `push` to main
- `pull_request` to main

#### 発火除外（paths-ignore）

**ドキュメントのみの変更では Quality / UT / IT / E2E の 4 本とも発火しない。**（Workflow Lint・Secret scan は除外せず常時実行する。4 本の `on:` は同一に保ち、一致を Workflow Lint が検査する） コードの動作に影響しない変更で E2E（1 回 3〜5 分）を回すコストを避けるため。

| 除外パターン | 対象 |
|---|---|
| `docs/**` | プロジェクトドキュメント |
| `manuals/**` | セットアップガイド等 |
| `**.md` | 全階層の Markdown（`README.md`・`CLAUDE.md` 含む） |
| `.claude/**` | Claude 向けルール・スキル |
| `LICENSE` | ライセンス |

`front/**`・`prisma/**`・`docker-compose.yml`・`Makefile`・`.github/workflows/**` は除外しない（**ワークフロー自体の変更は動作確認が必要**なため意図的に含めている）。

`paths-ignore` は「変更ファイルが**全て**該当した場合のみスキップ」する。コードとドキュメントが混在する PR では通常どおり実行される。

> **注意**: main に branch protection を設定してこれらを required status check に指定する場合、スキップされたジョブは「報告なし」となり PR がマージ不能になる。詳細は `.claude/rules/testing.md`「CI の発火条件」を参照。

### ワークフロー構成（6 本）

全ワークフローに最小権限の `permissions`（`contents: read`）と `concurrency`（PR のときだけ古い実行をキャンセル、main は毎回最後まで実行）を置く。規約は `.claude/rules/github-actions.md`。

| ワークフロー | ファイル | 内容 | 依存 |
|---|---|---|---|
| Workflow Lint | `.github/workflows/workflow-lint.yml` | actionlint（公式 Docker イメージ・shellcheck 込み）→ 4 本の `on:` の一致検査 | Docker のみ・数秒。**パスの絞り込みなしで常時実行** |
| Secret scan | `.github/workflows/secret-scan.yml` | `git ls-files` から鍵・`.env` 系の秘匿ファイルを検出（テンプレート・`env.d.ts` は除外） | 依存なし・数秒。**パスの絞り込みなしで常時実行** |
| Quality Checks | `.github/workflows/quality.yml` | `pnpm lint` → `pnpm format:check` → `pnpm typecheck` | `prisma generate` のみ（tsc が生成クライアントを解決するため）。Ollama / DB 不要 |
| Unit Tests | `.github/workflows/unit-test.yml` | `pnpm test:unit`（Vitest） | Ollama / DB 不要・数十秒 |
| Integration Tests | `.github/workflows/integration-test.yml` | `pnpm test:integration`（Vitest + Testcontainers） | Docker のみ（Testcontainers が PostgreSQL を起動）。Ollama 不要 |
| E2E Tests | `.github/workflows/e2e-test.yml` | `pnpm test:e2e`（Playwright） | Ollama + PostgreSQL |

Quality・UT・IT ジョブは Ollama を必要とせず、E2E と独立に高速実行される。IT は PostgreSQL サービスコンテナを使わず Testcontainers が使い捨て DB を起動するため、`prisma generate` のみ前処理として実行する。

**Quality ジョブが担うもの**: `.claude/rules/` で定めた機械強制可能な規約（JSDoc 規約・`import type` 強制・Prettier 整形・型健全性）の検証。**このジョブが無い間、規約違反や型エラーを含む変更が main にマージされ得た**（実際に発生した）。ローカルの `pnpm lint` 実行に依存せず CI で担保する。

### 実行環境（E2E）

| 項目 | 値 |
|------|-----|
| ランナー | `ubuntu-latest` |
| Node.js | 20 |
| PostgreSQL | 16（service container） |
| Ollama | `qwen2.5:0.5b`（思考モードなし、CPU only対応） |
| ブラウザ | Chromium（headless） |

### ワークフロー概要

1. ディスク容量確保（不要SDK削除）
2. 依存パッケージインストール（`pnpm install --frozen-lockfile`。lockfile と `package.json` がずれていれば失敗する）
3. Playwrightブラウザインストール（Chromiumのみ）
4. Ollama起動 + モデルダウンロード（`qwen2.5:0.5b`）
5. PostgreSQL service containerで自動起動
6. Prismaマイグレーション実行 + クライアント生成
7. Next.jsビルド
8. Playwright E2Eテスト実行
9. テスト結果・スクリーンショット・トレースをArtifactにアップロード

### CIスキップ対象テスト

CPU onlyのCIランナーではLLM推論が遅いため、以下のテストをスキップ:

| テストファイル | スキップ対象 | 理由 |
|---------------|-------------|------|
| `chat-streaming.spec.ts` | ストリーミング完了を待つ4テスト | CPU onlyで120秒以内に完了しない |
| `agent.spec.ts` / `agent-phase-c.spec.ts` | ツール呼び出しに依存する 5 テスト | 軽量モデルではツール呼び出しが安定しない（`IS_LIGHT_MODEL` で判定するため、ローカルでも既定ではスキップ） |
| `agent-metadata.spec.ts` | エージェントの応答を再読み込みするテスト | CPU onlyでエージェント応答の完了が遅い |
| `screenshot.spec.ts` | 全テスト | OS間フォントレンダリング差異 |

### CI固有の技術的考慮事項

- **Clipboard API**: ヘッドレスChromiumでは使用不可。`nativeInputValueSetter` + `dispatchEvent` で代替
- **Shift+Enter**: `keyboard.down('Shift')` → `keyboard.press('Enter')` → `keyboard.up('Shift')` で明示的に実行
- **Prismaクライアント**: `src/generated/prisma/` はgitignoreのため、CI上で `prisma generate` が必須
- **ディスク容量**: プリインストールSDK削除で確保（.NET, Android SDK, GHC等）

詳細は `docs/08-ci-e2e-bug-report.md` を参照。
