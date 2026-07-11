# テスト要件書

> 最終更新: 2026-07-11

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
- **ブラウザ**（E2E）: Chromiumのみ。
- **CI**: GitHub Actionsで自動実行（UT・IT・E2Eは独立ジョブ）。

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
| 対象（初期） | `/api/conversations`（作成/一覧）・`[id]`（削除・cascade）・`[id]/messages`（保存/取得） |
| 実依存 | PostgreSQL を Testcontainers で使い捨て起動（開発DBに触れない） |
| モック | 真の外部3rd-party（Ollama/Web）のみ手製fetchスタブ。初期対象は外部依存が無く mock なし |
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

**異常系**
- 存在しない会話IDへのアクセス時にエラーが表示される

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

- ベースラインスクリーンショットは `front/tests/e2e/__screenshots__/` に保存
- デザイン変更時はベースラインを更新する（`pnpm test:e2e --update-snapshots`）

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
  use: {
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  retries: 1,
}
```

## テストファイル構成

```
front/tests/
├── unit/                         # ユニットテスト（Vitest）
│   ├── validation.test.ts        # isValidUUID・入力上限定数
│   ├── calculate.test.ts         # calculateTool 式評価パーサー
│   └── agent-prompts.test.ts     # getPresetById・プリセット不変条件
├── integration/                  # インテグレーションテスト（Vitest + Testcontainers）
│   ├── helpers/
│   │   ├── global-setup.ts       # 使い捨てPostgreSQL起動 + migrate deploy
│   │   ├── setup-env.ts          # 接続URLを DATABASE_URL に注入
│   │   └── db.ts                 # resetDb・NextRequest/コンテキスト構築
│   ├── conversations.test.ts     # 作成/一覧（POST/GET）
│   ├── conversation-delete.test.ts # 削除・cascade・UUID/404/500
│   └── messages.test.ts          # メッセージ保存/取得・バリデーション
└── e2e/
    ├── helpers/
    │   └── test-data.ts          # テストデータ管理ヘルパー（CRUD・入力支援）
    ├── chat.spec.ts              # チャット機能テスト
    ├── chat-streaming.spec.ts    # ストリーミング表示テスト
    ├── chat-loading.spec.ts      # ローディング表示テスト
    ├── sidebar.spec.ts           # サイドバー操作テスト
    ├── conversation.spec.ts      # 会話管理テスト（CRUD・永続化）
    ├── security.spec.ts          # セキュリティテスト（XSS・文字数制限）
    ├── responsive.spec.ts        # レスポンシブ・レイアウトテスト
    ├── agent.spec.ts             # エージェント基盤テスト（Phase A）
    ├── agent-phase-b.spec.ts     # 調査系ツールテスト（Phase B: web_search / url_fetch）
    ├── agent-phase-c.spec.ts     # 自律エージェントテスト（Phase C: 思考過程・プリセット）
    ├── screenshot.spec.ts        # スクリーンショットテスト（CIスキップ）
    ├── debug-console.spec.ts     # デバッグ用テスト（CIスキップ）
    ├── debug-input.spec.ts       # 入力方式デバッグ用テスト（CIスキップ）
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

### ワークフロー構成（3ジョブ）

| ワークフロー | ファイル | 内容 | 依存 |
|---|---|---|---|
| Unit Tests | `.github/workflows/unit-test.yml` | `pnpm test:unit`（Vitest） | Ollama / DB 不要・数十秒 |
| Integration Tests | `.github/workflows/integration-test.yml` | `pnpm test:integration`（Vitest + Testcontainers） | Docker のみ（Testcontainers が PostgreSQL を起動）。Ollama 不要 |
| E2E Tests | `.github/workflows/e2e-test.yml` | `pnpm test:e2e`（Playwright） | Ollama + PostgreSQL |

UT・IT ジョブは Ollama を必要とせず、E2E と独立に高速実行される。IT は PostgreSQL サービスコンテナを使わず Testcontainers が使い捨て DB を起動するため、`prisma generate` のみ前処理として実行する。

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
2. 依存パッケージインストール（`pnpm install`）
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
| `screenshot.spec.ts` | 全テスト | OS間フォントレンダリング差異 |
| `debug-console.spec.ts` | 全テスト | デバッグ専用 |
| `debug-input.spec.ts` | 全テスト | デバッグ専用 |

### CI固有の技術的考慮事項

- **Clipboard API**: ヘッドレスChromiumでは使用不可。`nativeInputValueSetter` + `dispatchEvent` で代替
- **Shift+Enter**: `keyboard.down('Shift')` → `keyboard.press('Enter')` → `keyboard.up('Shift')` で明示的に実行
- **Prismaクライアント**: `src/generated/prisma/` はgitignoreのため、CI上で `prisma generate` が必須
- **ディスク容量**: プリインストールSDK削除で確保（.NET, Android SDK, GHC等）

詳細は `docs/08-ci-e2e-bug-report.md` を参照。
