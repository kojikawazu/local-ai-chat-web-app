# テスト要件書

> 最終更新: 2026-10-27

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
  - **UT**: 外部I/O非依存の純ロジックを対象（`lib/shared/validation.ts`・`lib/agent/tools/calculate.ts`・`lib/agent/agent-prompts.ts` 等）。外部I/O（fetch/DB）のみモックし、ビジネスロジックはモックしない。UIコンポーネント単位のユニットテストは実施しない（E2Eで担保）。
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

**エージェントの応答の時系列（`agent-timeline.spec.ts`、#186）**（保存済みの metadata の `contentOffset` から並べるため、モデルに依存せず CI でも動く）
- 正常系: 説明 → ツールの結果 → 回答の順に縦に並び、回答の吹き出しに説明を重ねて出さない
- 準正常系: `contentOffset` を持たない古い応答は、従来どおり吹き出し → ツールの一覧の順
- 異常系: ツールの後で停止して回答が無い応答は、空の吹き出しを出さず中断の表示を出す

**生成中の会話の切り替え（`conversation-switch.spec.ts`、#147）**（生成中の時間は `/api/chat` の応答をテストが手放すまで止めて作る。時間で遅らせると、否定の検証が待つ間に生成が終わって素通りするため）
- 正常系: 生成中に別の会話へ切り替えても、切り替え先には応答が混ざらず、入力でき、停止ボタンも出ない。生成中のうちに戻ると質問と生成中の表示が残っていて、応答が届くと表示・保存される。生成の途中で戻ると、途中までの本文と続きが表示される（実際の Ollama で長い応答を生成させる。戻る前に終わったら送り直す）
- 準正常系: 新規会話の最初の送信中に別の会話へ移っても、作られた会話に応答が保存され、表示中の会話には混ざらない。生成中の会話にだけサイドバーの印が付き、生成が終わると消える
- 異常系: 生成中の会話を削除すると、生成を止め（要求が中断される）、応答を保存せず、どこにもエラーを出さない。裏の会話で起きたエラーは表示中の会話には出ず、元の会話に戻ると表示される

**会話検索（`search.spec.ts`、#11）**（会話は API で用意するため、モデルに依存せず CI でも動く。検索の条件は IT、抜粋・強調の分割は UT が担う）
- 正常系: 本文のキーワードで会話が見つかり、抜粋の一致箇所が強調され、押すとその会話が開く。空白で区切った語をすべて含む会話だけが見つかる
- 準正常系: 一致が無ければその旨を表示し、× で履歴一覧に戻る。Escape で検索をやめる。結果が多いときは「さらに表示」で続きを読める
- 異常系: 検索 API が失敗したら理由を表示し、検索をやめれば履歴一覧を使い続けられる（`page.route` で検索 API だけを失敗させる）

**設定モーダルの開閉（`settings-modal.spec.ts`、#163）**（共通の `Modal`。ネイティブの `<dialog>`。Ollama を使わないため CI でも動く）
- 正常系: Close・× ボタン・Escape で閉じ、フォーカスが「設定を開く」へ戻る
- 準正常系: 背景のクリックで閉じる。ダイアログの中のクリックや、中で押して背景で離した場合（文字の選択など）は閉じない
- 異常系: 開いている間は Tab を押し続けてもフォーカスが背景の要素へ移らない

役割ダイアログ（`system-prompt.spec.ts`）は入力を失わないよう、背景のクリックでは閉じない（準正常系で確かめる）。

**書き出し（`export.spec.ts`、#12）**（会話は API で用意する。Playwright のダウンロードのイベントで、保存されたファイルの名前と中身を確かめる。形式の細かい決まりは UT（`export.test.ts`）が担う）
- 正常系: 応答の「Markdown で保存」で応答の原文が `.md` で保存される。会話全体を Markdown で書き出すと質問と応答が見出し付きで並び（ツールの結果は入らない）、ダイアログが閉じてフォーカスがボタンへ戻る。JSON ではツールの結果を含めてすべて残る
- 準正常系: 新しい会話では「会話を書き出す」を押せない。キャンセルでは保存せずに閉じる。応答の生成中は押せず、止めると押せる（実際の Ollama で長い応答を生成させる）
- 異常系: ファイル名に使えない文字（`/`・`:`・`*`・`?`）を含むタイトルでも、保存するファイル名に残らない

**画像添付（`image-attachment.spec.ts`、#6）**（テスト用の画像はブラウザの canvas で作る。ドラッグ＆ドロップ・貼り付けは `DataTransfer` を組んで `drop` / `paste` のイベントを起こす。保存済みの画像は API で投入する）
- 正常系: 添付ボタンで選んだ画像が選んだ順にプレビューに出て、外せる。長辺 1,280px を超える画像は縦横比を保って縮小される（`naturalWidth` で確かめる）。ドラッグ＆ドロップ・貼り付けで添付できる。保存済みの画像付きの会話を開くと画像を表示し、押すと拡大できる。画像を送ると応答が返り、開き直しても取得 API から画像を表示する（**画像に対応したモデルのときだけ**。`/api/models` の `visionModels` で判定し、CI の `qwen2.5:0.5b` ではスキップ）
- 準正常系: 5 枚目は添付せず上限を伝える。画像に対応していないモデルでは案内を出して送信させず、画像を外すと送れる（**非対応のモデルのときだけ**）。本文が空なら画像だけでは送れない
- 異常系: 画像でないファイル・SVG は理由を出して添付しない。中身の壊れた画像は読み込めないことを伝えて添付しない

**ローカルのファイルのツール（`local-files.spec.ts`、#148）**（dev サーバーには `playwright.config.ts` が `LOCAL_FILE_ROOTS` として `tests/e2e/fixtures/local-files/` を渡す。表示は保存済みの metadata から確かめる）
- 正常系: `GET /api/tools` に 3 つのツールが出る。保存済みの `read_file` の結果が「ファイルを読む」と読んだ範囲で出る。エージェントモードで実際にファイルを読ませると、ツールの結果と答えが出る（**ツール呼び出しが要るため軽量モデルではスキップ**）
- 準正常系: 見つからなかった検索が ⚠️ と 0 件で出る
- 異常系: ファイルを読んだ後に止めた `url_fetch` が ❌ と止めた理由で出る

**ファイルの書き込みの承認（`file-write-approval.spec.ts`、#148 Phase A2）**（dev サーバーには `playwright.config.ts` が `LOCAL_FILE_WRITE_ROOTS` として OS の一時フォルダの E2E 用のフォルダを渡す。リポジトリの中は書き換えない）
- 正常系: `GET /api/tools` に書き込みのツールが出る。モデルに書き換えを頼むと承認カードに差分が出て、許可するまで書き換わらず、許可すると書き換わる（**ツール呼び出しが要るため軽量モデルではスキップ**）
- 準正常系: 拒否するとファイルは書き換わらず、❌ と「拒否されました」が出る（同上）
- 異常系: 承認の API は、待っている承認の無い ID で 404・不正な ID で 400

**コマンドの実行の承認（`command-approval.spec.ts`、#148 Phase B）**（dev サーバーには `playwright.config.ts` が `LOCAL_COMMANDS=node` を渡す。作業フォルダは上の書き込みのフォルダ）
- 正常系: `GET /api/tools` に `run_command` が出る。モデルにコマンドの実行を頼むと承認カードにコマンドと作業フォルダが出て、許可するまで実行されず、許可すると実行される（**ツール呼び出しが要るため軽量モデルではスキップ**）
- 準正常系: 拒否すると実行されず、❌ と「拒否されました」が出る（同上）
- 異常系: 終了コードが 0 以外のコマンドは、許可して実行した後に ❌ と終了コードが出る（同上）。承認の API の 404・400 は同じ API のため上の spec に任せる

**ツールの結果の要約（`tool-result-summary.spec.ts`、#150）**（保存済みの metadata から表示するため、モデルに依存せず CI でも動く）
- 正常系: 検索の件数が見出しに ✅ とともに出る
- 準正常系: 0 件は ✅ ではなく ⚠️ で出る。要約を持たない古いデータは、これまでどおり成否と所要時間だけを出す
- 異常系: 失敗は ❌ と理由が出て、長い理由の全文はツールチップで読める。展開すると結果の全文がエラーとして出る

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
| 渡し方 | `webServer.env` で dev サーバーの `OLLAMA_MODEL` に設定。Next.js は既存の環境変数を `.env.local` で上書きしないため、こちらが優先される。同じく `LOCAL_FILE_ROOTS` に E2E 用のフォルダ（`tests/e2e/fixtures/local-files/`）を、`LOCAL_FILE_WRITE_ROOTS` に OS の一時フォルダの E2E 用のフォルダを、`LOCAL_COMMANDS` に `node` を渡す（#148） |
| 事前準備 | `ollama pull qwen2.5:0.5b` |
| 開始前の検証 | `global-setup.ts` が `/api/models` を確認し、再利用した dev サーバーのモデルが異なる・モデル未取得なら開始前に止める（502 なら検証を省略）。あわせて `/api/diagrams/plantuml` で PlantUML サーバーに繋がるかを確かめ、繋がらなければ `docker compose up -d` の案内とともに止める（#171） |
| 軽量モデルでのスキップ | ツール呼び出しに依存するテスト（`agent.spec.ts` 3 件・`agent-phase-c.spec.ts` 2 件）は `IS_LIGHT_MODEL` でスキップ |
| 応答の完了待ち | `waitForResponseComplete`（`helpers/test-data.ts`）を使う。送信ボタンは入力欄が空だと有効にならないため、1 文字入力してから有効化を待つ（#115）。ローディング表示は最初のチャンクまでしか出ないので完了の判定には使えない |
| 一瞬の状態の検証 | 軽量モデル（GPU）は応答が速く、ローディング表示が数十 ms で消える。送信後に待ち始める・Playwright のポーリングで待つと取りこぼすため、`chat-loading.spec.ts` は送信前に MutationObserver で監視を始める（`watchLoadingIndicator`） |
| 長い応答が必要な検証 | 軽量モデルは指示どおり長く答えるとは限らない。`helpers/long-answer.ts`（`streaming-stop.spec.ts`・`regenerate.spec.ts`・`conversation-switch.spec.ts` が使う）は長くなりやすいプロンプト（日本の歴史を各時代について）を使い、止める前に終わったら送り直す（最大 3 回） |
| `page.route` で遅らせたリクエスト | 遅らせた後の `route.continue()` は、ページが中断した後でもサーバーへ転送する。受け手のいない生成が Ollama を占有して後続のテストを数分待たせたため、中断させるリクエストは転送せず `route.fulfill()` で返す（#8） |

## テストファイル構成

```
front/tests/
├── unit/                         # ユニットテスト（Vitest）
│   ├── validation.test.ts        # isValidUUID・入力上限定数
│   ├── request-body.test.ts      # JSON ボディの実行時検証（非オブジェクト・型不正・履歴の上限・図のソースの上限・添付画像と imageIds の検証）
│   ├── attachment.test.ts        # 添付画像の形式の判定（PNG / JPEG・SVG 等は null）・Base64 の厳密な復号・復号後のバイト数（#6）
│   ├── chat-images.test.ts       # LLM へ渡す画像の選び方（新しい順・合計の上限・メッセージ単位・非対応モデル）と省略の注記（#6）
│   ├── conversation-history.test.ts # 会話履歴の組み立て（失敗した user の除外・件数／長さの上限）
│   ├── regenerate.test.ts        # 再生成できる応答の判定（最後・保存済み）と送り直す質問・履歴
│   ├── calculate.test.ts         # calculateTool 式評価パーサー・要約・失敗の isError
│   ├── read-body.test.ts         # 本文のバイト上限付きストリーム読み取り・中断
│   ├── web-search.test.ts        # SearXNG の応答の整形（上位 5 件・0 件と失敗の区別・不正な形・件数の要約）
│   ├── url-fetch.test.ts         # 取得した本文の整形（文字数の要約・5,000 文字での省略・本文なし）
│   ├── agent-prompts.test.ts     # getPresetById・プリセット不変条件
│   ├── agent-config.test.ts      # エージェント設定の環境変数の検証（NaN・0・負数・小数・範囲外は既定値へ）
│   ├── message-metadata.test.ts  # metadata の組み立て・取得時の実行時検証（ツールの要約・空の結果・本文の位置を含む）
│   ├── agent-timeline.test.ts    # エージェントの応答の時系列（本文の位置での区切り・同じ位置のツールのまとまり・古いデータ・範囲外の位置）とラウンドの区切りの空行（#186）
│   ├── clipboard.test.ts         # コピー手段の選択（Clipboard API → 代わりのコピー）と失敗の判定
│   ├── code-block.test.ts        # コードブロックの言語名の取り出し（hljs 付き・未登録の言語・指定なし）と本文の連結
│   ├── diagram.test.ts           # 図の種類の判定（mermaid / plantuml / puml）・要素 ID・SVG の data: URI（記号・日本語）と大きさ（viewBox）・テーマの色の組み立て・PlantUML の API の応答の解釈・拡大の倍率の段階・保存の背景・PNG の大きさ（#176）
│   ├── plantuml.test.ts          # PlantUML のエラーの理由と行番号（0 始まり→1 始まり）からメッセージを作る処理
│   ├── export.test.ts            # 書き出しのファイル名（置き換え・切り詰め・絵文字）と、会話全体の Markdown / JSON の形（添付画像の注記を含む）
│   ├── image-attachment.test.ts  # 添付するファイルの選別（形式・大きさ・枚数）・縮小の大きさ・出力の形式・data: URI の Base64（#6）
│   ├── system-prompt.test.ts     # 役割とエージェントのプリセットの連結・表示名の逆引き・上限の不変条件・system メッセージの付与
│   ├── current-date.test.ts      # システムプロンプトに足す現在の日時（書式・タイムゾーン・モードごとの指示・不正なタイムゾーン）
│   ├── chat-state.test.ts        # 会話ごとのチャット状態（移す・残す・読み込みの反映・生成中の会話の一覧・捨てる）
│   ├── search.test.ts            # 会話検索のクエリの検証・キーワードの分解・抜粋の切り出し・強調の分割・LIKE のエスケープ
│   ├── sidebar-visibility.test.ts # サイドバーの表示状態の保存値の解釈（open / closed / 不正な値 / 未保存）（#24）
│   ├── tool-approval.test.ts     # 承認待ちの決着（許可・拒否・時間切れ・停止。偽のタイマー）・edit_file の一致と CRLF・差分の行数・.git の判定・拒否の文章・承認の API のボディ（#148 Phase A2）
│   ├── local-commands.test.ts    # コマンドの解釈（クォート・シェルの記号を断る・上限）・クォートし直し・許可リスト（シェル等を外す）・渡す環境変数・出力の先頭と末尾と制御文字・結果の文章（#148 Phase B）
│   ├── local-files.test.ts       # ローカルのファイルのツールの純関数（LOCAL_FILE_ROOTS の解釈・包含の判定・秘匿ファイルの名前・行の切り出し・ワイルドカード・結果の文章・持ち出しの判定。#148）
│   └── class-names.test.ts       # クラス名の連結（偽値を捨てる・衝突は解決しない）
├── integration/                  # インテグレーションテスト（Vitest + Testcontainers）
│   ├── helpers/
│   │   ├── global-setup.ts       # 使い捨てPostgreSQL起動 + migrate deploy
│   │   ├── setup-env.ts          # 接続URLを DATABASE_URL に注入
│   │   └── db.ts                 # resetDb・NextRequest/コンテキスト構築
│   ├── conversations.test.ts     # 作成/一覧（POST/GET）
│   ├── conversations-search.test.ts # 会話検索（タイトル・本文・大文字と小文字・AND・並び順・0 件・% と _・ページ分け・抜粋・metadata は対象外・400）
│   ├── conversation-delete.test.ts # 削除・cascade・UUID/404/500
│   ├── conversation-update.test.ts # 会話の役割の変更（保存・外す・他フィールドは変えない・400/404/500）
│   ├── messages.test.ts          # メッセージ保存/取得・バリデーション・role 別上限・トランザクション・クライアント採番の id（重複は 409）
│   ├── message-replace.test.ts   # 応答の置き換え（再生成）・対象の制限（同じ会話の assistant のみ）・metadata の消去・ロールバック
│   ├── chat.test.ts              # /api/chat（Ollama fetchスタブ・502契約・400）
│   ├── chat-agent.test.ts        # /api/chat エージェント経路（url_fetch / web_search のサイズ超過・タイムアウト中断・SSRF・リトライ停止・SearXNG の未起動 / 403 / 応答しない検索エンジン・失敗の isError と要約・0 件の空の結果・接続先ごと使えないツールを同じ応答で再び実行しない・ツールの本文の位置 contentOffset とラウンドの区切りの空行）
│   ├── chat-agent-local-files.test.ts # /api/chat エージェント経路のローカルのファイルのツール（読んだ後の url_fetch・web_search を実行しない・読む前・失敗後は止めない）と GET /api/tools への登録（#148）
│   ├── local-files.test.ts       # 一時フォルダでの list_directory・search_files・read_file（秘匿ファイル・シンボリックリンクと .. で外へ出られない・上限・バイナリ・行の範囲。#148）
│   ├── tools.test.ts             # GET /api/tools（LOCAL_FILE_ROOTS・LOCAL_FILE_WRITE_ROOTS が無ければローカルのファイルのツールを出さない。LOCAL_COMMANDS があっても書き込みのフォルダが無ければ run_command を出さない）
│   ├── local-file-write.test.ts  # 一時フォルダでの write_file・edit_file の準備と実行（作成・上書き・置き換え・CRLF・承認の間の変更・同名の新規・.git と秘匿と外・先の無いリンク・承認なしの execute。#148 Phase A2）
│   ├── chat-agent-approval.test.ts # /api/chat の承認の流れ（差分付きの承認の依頼・許可で書く・拒否で書かない・準備の失敗は承認を求めない・停止で取り消し）と承認の API（400 / 404）
│   ├── local-command.test.ts     # 実際に node を起動する run_command の準備と実行（出力・作業フォルダ・標準入力を閉じる・終了コード・環境変数の絞り込み・許可リスト／パス／シェルの記号／範囲外の作業フォルダを断る・時間の上限・停止で孫まで止める・親が先に終わったときの残り。#148 Phase B）
│   ├── chat-agent-command.test.ts # /api/chat のコマンドの承認の流れ（許可で実行・拒否で実行しない・実行中の停止でプロセスを止める・実行の後は外部と通信するツールを止める）と GET /api/tools
│   ├── chat-agent-max-rounds.test.ts # /api/chat エージェントの最大ラウンド到達（ツールなしの最終回答・注記・失敗時もツール結果を残す）
│   ├── chat-stop.test.ts         # /api/chat の生成停止（cancel・request.signal で Ollama の接続を切る・エージェントのツール中断と次ラウンド停止・499）
│   ├── chat-images.test.ts       # /api/chat の添付画像（DB から読んで images へ・履歴の画像・エージェント・非対応モデルの 400 と注記・上限超過の省略・見つからない ID・/api/show の失敗→502）
│   ├── attachments.test.ts       # 添付画像の保存（形式の判定・トランザクション・409）・メッセージ一覧の attachments・GET /api/attachments/[id]（ヘッダー・cascade・400/404）
│   ├── models.test.ts            # /api/models（Ollama fetchスタブ・502契約・visionModels）
│   ├── plantuml.test.ts          # /api/diagrams/plantuml（PlantUML fetchスタブ・SVG の中継・PlantUML の 400→400 と理由・入力の 400・接続失敗/時間切れ/500→502・切断→499）
│   └── generate-title.test.ts    # タイトル自動生成（モデル解決の正準性・切り詰め・500契約）
└── e2e/
    ├── helpers/
    │   ├── test-data.ts          # テストデータ管理ヘルパー（CRUD・入力支援）
    │   ├── long-answer.ts        # 長い応答を生成中にする（停止・再生成の検証用）
    │   ├── model.ts              # E2E のモデル解決（E2E_OLLAMA_MODEL・軽量モデル判定）
    │   ├── local-files.ts        # E2E の LOCAL_FILE_ROOTS（fixtures/local-files のフォルダ。#148）
    │   └── global-setup.ts       # 開始前に dev サーバーのモデル・モデル取得済み・PlantUML サーバーへの接続を検証
    ├── chat.spec.ts              # チャット機能テスト
    ├── chat-streaming.spec.ts    # ストリーミング表示テスト
    ├── chat-loading.spec.ts      # ローディング表示テスト
    ├── copy.spec.ts              # 応答・コードブロックのコピー・結果表示・代わりのコピー・失敗表示
    ├── diagram.spec.ts           # Mermaid の図（img での表示・ソースのコピー・複数・テーマ追従・生成後の描画・構文の誤り・空・大文字・XSS の非実行・失敗の局所化）、PlantUML の図（実サーバーでの描画・@startuml なし・構文の誤りと行番号・空・SANDBOX の include 拒否・API の失敗の注入）、図の共通の操作（ソースとの切り替え・拡大の倍率・SVG / PNG の保存の中身・描けない図にボタンを出さない・倍率の端・PNG の変換の失敗の注入）
    ├── export.spec.ts            # 応答・会話の書き出し（Markdown で保存・会話全体の Markdown / JSON・押せない条件・ファイル名）
    ├── image-attachment.spec.ts  # 画像添付（ファイル選択・D&D・貼り付け・縮小・プレビューと削除・枚数と形式・非対応モデルの案内・保存済みの画像の表示と拡大・送信と復元）
    ├── system-prompt.spec.ts     # 会話の役割（新規会話での保存と送信への付与・既存会話の変更・役割なし・キャンセル/Escape・新規会話で持ち越さない・エージェントでの連結・保存失敗・上限）
    ├── syntax-highlight.spec.ts  # シンタックスハイライト（テーマ変数の色・テーマ追従・言語指定なし・未登録の言語（COBOL）・インラインコード・HTML タグの非実行・閉じていないフェンス）
    ├── streaming-stop.spec.ts    # 生成の停止（Stop ボタン・Escape・本文前の停止・中断した応答の保存と保存失敗）
    ├── conversation-switch.spec.ts # 生成中の会話の切り替え（応答が届き続ける・切り替え先の操作・途中で戻る・新規会話の最初の送信・サイドバーの印・削除で停止して保存しない・裏のエラー）
    ├── regenerate.spec.ts        # 応答の再生成（置き換えと永続化・最後の応答のみ・本文前の停止と生成失敗で旧応答へ復元・生成中は無効・置き換えの保存失敗と再試行）
    ├── search.spec.ts            # 会話検索（本文での一致と強調・AND・0 件・× と Escape・さらに表示・検索の失敗）
    ├── sidebar.spec.ts           # サイドバー操作テスト・表示の切り替え（隠す・戻す・保存・不正な保存値・モバイルへの非影響・localStorage の例外の注入）
    ├── conversation.spec.ts      # 会話管理テスト（CRUD・永続化）
    ├── security.spec.ts          # セキュリティテスト（XSS・文字数制限）
    ├── responsive.spec.ts        # レスポンシブ・レイアウトテスト
    ├── mobile-navigation.spec.ts # モバイルのドロワー（会話の切替・新規・削除・設定、aria・フォーカス・Escape）
    ├── theme.spec.ts             # テーマ切替・localStorage永続化テスト
    ├── settings-modal.spec.ts    # 設定モーダルの開閉（Close・×・Escape・背景のクリック・フォーカスの戻り先・閉じ込め）
    ├── agent.spec.ts             # エージェント基盤テスト（Phase A）
    ├── agent-phase-b.spec.ts     # 調査系ツールテスト（Phase B: web_search / url_fetch）
    ├── agent-phase-c.spec.ts     # 自律エージェントテスト（Phase C: 思考過程・プリセット）
    ├── agent-metadata.spec.ts    # エージェント応答の付随情報（思考過程・ツール結果・ラウンド数・所要時間）の復元
    ├── agent-timeline.spec.ts    # エージェントの応答を説明 → ツールの結果 → 回答の順に並べる表示（古いデータ・回答前の停止）
    ├── tool-result-summary.spec.ts # ツールの結果パネルの見出し（件数・0 件の ⚠️・失敗の ❌ と理由・要約なしの古いデータ）
    ├── local-files.spec.ts       # ローカルのファイルのツール（一覧への登録・保存済みの結果の表示・止めた外部のツール・実際に読ませる（大モデルのみ））
    ├── file-write-approval.spec.ts # ファイルの書き込みの承認（承認カードの差分・許可で書く・拒否で書かない（大モデルのみ）・承認の API の 404 / 400）
    ├── command-approval.spec.ts # コマンドの実行の承認（一覧への登録・承認カードのコマンドと作業フォルダ・許可で実行・拒否で実行しない・失敗の終了コード（大モデルのみ））
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
