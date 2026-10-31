# HTML レポートと PDF の書き出し 設計書

> 最終更新: 2026-10-31

応答・会話を、スタイル付きの 1 ファイルの HTML（レポート）として保存し、同じ HTML をブラウザの印刷で PDF にできるようにするための設計（#36 の Phase A・Phase E と、Phase F の書き出しの入口。サブ issue #219）。HTML スライド・DOCX・PPTX は後のサブ issue に回す。

## 目次

- [背景](#背景)
- [今の書き出し](#今の書き出し)
- [範囲](#範囲)
- [決めること（レビューの論点）](#決めることレビューの論点)
- [書き出しの流れ](#書き出しの流れ)
- [Markdown から HTML への変換](#markdown-から-html-への変換)
- [レポートの中身と見た目](#レポートの中身と見た目)
- [PDF](#pdf)
- [画面](#画面)
- [ファイル構成](#ファイル構成)
- [テスト](#テスト)
- [やらないこと](#やらないこと)

## 背景

応答を人に渡したり、資料として残したりするとき、今は Markdown（原文）か JSON でしか保存できない。Markdown は受け取った人がそのままでは読みにくく、表・コード・図が整形されない。チャットの画面と同じように整形された HTML や PDF で保存できれば、ブラウザで開くだけ・印刷するだけで読める。

## 今の書き出し

| 入口 | 形式 | 中身 |
|---|---|---|
| 応答の下の「Markdown で保存」（#12。19-2） | Markdown | その応答の本文の原文だけ |
| ヘッダーの「会話を書き出す」のダイアログ（#12） | Markdown | タイトル・書き出した日時・会話の役割と、メッセージを「ユーザー / アシスタント（日時）」の見出しで並べる。思考過程・ツールの結果は入れない。添付画像は `[画像 n 枚]` |
| 同上 | JSON | すべて（バックアップ用） |

書き出しはどれもブラウザの中で文字列を作って保存させる（`lib/chat/export.ts`・`lib/shared/download.ts`）。サーバーは使っていない。

## 範囲

| 含める | 含めない（[やらないこと](#やらないこと)） |
|---|---|
| 応答・会話の HTML レポート（1 ファイル。画像・図・CSS を埋め込む） | HTML スライド・DOCX・PPTX（後のサブ issue） |
| 同じ HTML をブラウザの印刷で PDF にする | サーバーでの PDF の生成（Chromium・puppeteer） |
| 応答・会話の書き出しのダイアログに HTML・PDF を足す | レポートのテンプレートの選択・カスタマイズ |
| 図（Mermaid・PlantUML）・添付画像の埋め込み | 書き出す前のプレビュー |

## 決めること（レビューの論点）

| 論点 | 推奨 | 他の案 | 理由 |
|---|---|---|---|
| どこで作るか | **ブラウザの中**（今の Markdown・JSON の書き出しと同じ） | issue の案の Route Handler（`GET /api/export/html`） | 表示中のメッセージはもうブラウザにある。Mermaid の図はブラウザでしか描けない。サーバーに送り直す API が要らない |
| Markdown → HTML の変換 | **unified（remark → rehype）で HTML の文字列を作る**（チャットの表示と同じ remark-gfm・rehype-highlight を使う） | 画面の `MarkdownContent` を描いた DOM を写す | 画面の DOM にはコピーのボタン・図の操作のボタンが混ざる。unified なら純関数になり、UT で確かめられる。react-markdown が使う部品と同じなので、表・コードの解釈が画面と揃う |
| 生の HTML・URL | **本文の生の HTML は通さない**（テキストのまま）。リンクは react-markdown と同じ判定（`defaultUrlTransform`）で危ない URL（`javascript:` 等）を外す。**本文の外部の画像（`![](https://…)`）は埋め込まず、リンクにする** | そのまま出す | レポートはブラウザで開くファイルなので、LLM の出力に紛れたスクリプト・外部への読み込みを入れない。画面（CSP の `img-src 'self' data:`）でも外部の画像は出していない |
| 図 | **書き出すときに描いて SVG を `data:` URI の `<img>` で埋め込む**（Mermaid はブラウザで、PlantUML は `/api/diagrams/plantuml` で）。描けなければソースのコードブロックのまま | 図はソースのまま | レポートとして読むなら図で見たい。`<img>` に入れるのは画面と同じ扱い（SVG を DOM に入れない） |
| 添付画像 | **user の添付画像は `data:` URI で埋め込む**（`/api/attachments/[id]` から読む） | `[画像 n 枚]` と書く（Markdown と同じ） | HTML は画像を入れられる。1 ファイルで完結させる（送った相手がアプリの API に繋がらなくても見える） |
| 中身（会話） | **Markdown の書き出しと同じ**（タイトル・書き出した日時・役割・メッセージ。思考過程・ツールの結果・ツールの画面は入れない） | ツールの結果も入れる | 読み物として渡す用途。全部が要るときは JSON がある |
| 中身（応答 1 件） | **その応答の本文だけ**（今の「Markdown で保存」と同じ）。見出しに会話のタイトルと応答の日時 | 直前の質問も入れる | 「応答を資料にする」用途。質問まで要るときは会話ごと書き出す |
| 見た目 | **明るい背景の印刷向けの 1 つのテンプレート**（Nord の色をアクセントに使う）。CSS はファイルに埋め込む | アプリのテーマ（暗い背景）に合わせる | 紙・PDF にしても読める。テーマごとに作ると 3 倍の手間になる |
| PDF | **同じ HTML を、画面に出さない iframe に読み込んで、ブラウザの印刷を開く**（「PDF として保存」を選んでもらう） | サーバーで Chromium（playwright-core）を使って PDF を作る | 新しい依存・サーバーの処理が要らない。ブラウザのツールの Chromium は `BROWSER_ENABLED` のときしか入っていない。印刷のダイアログが 1 回挟まるが、用紙・余白も選べる |
| 入口 | **応答の下の「Markdown で保存」を「保存」にして、形式（Markdown・HTML・PDF）を選ぶダイアログを開く。** 会話の書き出しのダイアログに HTML・PDF を足す | 応答の下にドロップダウンのメニュー | 書き出しのダイアログ（共通の `Modal`）を使い回せる。メニューの部品を新しく作らずに済む |
| 新しい依存 | **`unified`・`remark-parse`・`remark-rehype`・`hast-util-to-html` を直接の依存にする**（前の 3 つは react-markdown が使っていて、ロックファイルにもう同じ版がある） | 自前で HTML を組み立てる | HTML のエスケープを自前で書かない（取りこぼすと XSS になる） |

## 書き出しの流れ

```
書き出しのダイアログで HTML か PDF を選ぶ
  → ① 本文から図（mermaid・plantuml のコードブロック）を拾う（純関数）
  → ② 図を描く（Mermaid はブラウザ・PlantUML は API）・添付画像を読む（並べて待つ）
  → ③ HTML を組み立てる（純関数。②の結果を受け取る）
  → HTML: ファイルとして保存 / PDF: iframe で印刷を開く
```

- ①・③ は純関数にして UT で確かめる。② は I/O なので、フックに置き、失敗したものは「描けなかった図」「読めなかった画像」として ③ に渡す（図はソースのコードブロック、画像は「画像を読み込めませんでした」の注記にする）。
- 書き出しの間はダイアログのボタンを押せなくし、「作成中…」を出す。

## Markdown から HTML への変換

```
remark-parse → remark-gfm → remark-rehype（生の HTML は通さない）
  → 図のコードブロックを <img> に置き換える（描けた図だけ）
  → rehype-highlight（コードの色付け。画面と同じ）
  → リンクの URL の検査・外部の画像をリンクに置き換える
  → hast-util-to-html
```

- 図の置き換えは、コードブロックの言語（`lib/chat/diagram.ts` の `getDiagramKind`）とソースの文字列で、描けた図を引く。
- 画面の表示と同じく、Markdown の中の生の HTML（`<script>` 等）はテキストとして出す。
- `hast-util-to-html` が文字列をエスケープする。テンプレートに差し込むタイトル・役割・日時も、hast（構文木）として組み立ててから文字列にする（文字列の連結で HTML を作らない）。

## レポートの中身と見た目

- 1 つの HTML ファイル（`<!doctype html>`・`<meta charset="utf-8">`・`<title>`・`<style>`）。スクリプトは入れない。
- 先頭: 会話のタイトル（`<h1>`）・書き出した日時・会話の役割（あれば）。
- メッセージ: 「ユーザー」「アシスタント」の見出しと日時。ユーザーは添付画像を本文の前に並べる。中断した応答には「（生成を中断した応答）」。
- CSS: 明るい背景・本文の幅 48em・Nord の青をアクセント。表・コード（背景・等幅・横にスクロール）・引用・図。コードの色は rehype-highlight のクラスに合わせる。印刷用に `@page`（A4・余白）と、コード・図・画像・表の途中で改ページしない指定。
- ファイル名は今の書き出しと同じ（`<タイトル>_<YYYY-MM-DD_HHmm>.html`）。

## PDF

- 組み立てた HTML を、画面の外に置いた iframe（`srcdoc`）に読み込み、画像の読み込みを待ってから `iframe.contentWindow.print()` を呼ぶ。印刷のダイアログが閉じたら iframe を消す。
- iframe はアプリと同じオリジン（`srcdoc`）で、中の文書はアプリの CSP（`img-src 'self' data:`・`style-src 'unsafe-inline'`）を受け継ぐ。スクリプトは入れないので `script-src` に関わらない。`srcdoc` の iframe を `frame-src`（`default-src 'self'`）が止めないことは E2E（`report-export.spec.ts` の PDF のテスト。印刷した文書の見出しと CSS を確かめる）で確かめた。
- ダイアログの説明に「印刷の画面で『PDF として保存』を選んでください」と書く。

## 画面

- **応答の下**: 「Markdown で保存」（ダウンロードのアイコン）を「保存」にし、押すと書き出しのダイアログを応答 1 件の内容で開く（形式: Markdown・HTML・PDF）。
- **会話の書き出しのダイアログ**: 形式に HTML・PDF を足す（Markdown・HTML・PDF・JSON の順）。
- ダイアログは 1 つの部品（`ExportDialog`）で、会話全体か応答 1 件かを props で切り替える。
- 書き出しに失敗した（図・画像の取得ではなく、HTML の組み立て・印刷そのものの失敗）ときは、ダイアログの中にエラーを出す。

## ファイル構成

```
front/src/
├── lib/chat/report-html.ts              # 図の拾い出し・Markdown → HTML・レポートの組み立て（純関数）
├── lib/chat/report-style.ts             # レポートの CSS（文字列の定数。テンプレートに埋め込む）
├── lib/chat/export.ts                   # 日時の書き方・タイトルの整え方・role の見出しをレポートと共有する
├── lib/shared/print.ts                  # HTML を iframe で印刷する（ブラウザの API の境界）
├── constants/chat/diagram.ts            # 図のフォント・PlantUML の API のパス（画面の図とレポートの図で共有）
├── hooks/chat/useReportExport.ts        # 図を描く・画像を読む → 組み立て → 保存 / 印刷（状態: 作成中・エラー）
├── components/features/chat/organisms/ExportDialog.tsx  # 会話全体 / 応答 1 件、形式に HTML・PDF
├── components/features/chat/organisms/ChatWindow.tsx    # 応答の下の「保存」でダイアログを開く
└── app/page.tsx                         # 応答 1 件のダイアログを開く状態
```

- Mermaid は、レポートが明るい背景のため、画面のテーマの色ではなく mermaid の `default` テーマで描く（`useReportExport` の中）。図の文字のフォントと PlantUML の API のパスは、画面の図と揃えるため `constants/chat/diagram.ts` へ昇格した。
- `package.json` に `unified`・`remark-parse`・`remark-rehype`・`hast-util-to-html` を足す。

## テスト

| 層 | 対象 |
|---|---|
| UT（`report-html.test.ts`） | 図の拾い出し（mermaid・plantuml・ほかの言語は拾わない・同じソースは 1 つ）・変換（見出し・表・リスト・コードの色付けのクラス・生の HTML をテキストにする・`javascript:` のリンクを外す・外部の画像をリンクにする・描けた図を `<img>` に・描けなかった図はコードブロック）・レポート（タイトル・日時・役割のエスケープ・ユーザーとアシスタントの見出し・添付画像の `data:` URI・読めなかった画像の注記・中断の注記・`<script>` が無い・応答 1 件のときは本文だけ）・ファイル名の拡張子 |
| IT | 対象なし（API・DB を変えない。PlantUML の図は今の `/api/diagrams/plantuml` を使う） |
| E2E（`report-export.spec.ts`） | 会話の書き出しのダイアログで HTML を保存し、ファイルの中身（タイトル・見出し・表・コードの色付け・添付画像の `data:` URI・スクリプトが無い）を確かめる。応答の「保存」から HTML を保存する（本文だけ）。PDF を選ぶと印刷が開く（`print` をブラウザの API の境界で差し替えて呼ばれたことを確かめる）。Mermaid の図が `<img>` で入る。PlantUML のサーバーが失敗したら図はソースのまま入る（`page.route`）。会話と応答は API で作る（Ollama を使わない） |

## やらないこと

- HTML スライド・DOCX・PPTX（#36 の後のサブ issue）
- サーバーでの PDF の生成（Chromium・puppeteer）
- レポートのテンプレートの選択・カスタマイズ・アプリのテーマに合わせた見た目
- 書き出す前のプレビュー
- 思考過程・ツールの結果・ツールの画面をレポートに入れる（全部が要るときは JSON）
