# シンタックスハイライト・図表レンダリング 設計書

> 最終更新: 2026-10-25

AI 応答のコードブロックを言語別に色付けし（フェーズ20-1 / #144）、Mermaid / PlantUML を図表として描画する（フェーズ20-2 / #169・20-3 / #171。20-4 は未着手）ための設計。親 issue は #13。

## 目次

- [シンタックスハイライト（20-1）](#シンタックスハイライト20-1)
  - [ライブラリの選定](#ライブラリの選定)
  - [描画の流れ](#描画の流れ)
  - [配色（テーマ対応）](#配色テーマ対応)
  - [言語名ラベル](#言語名ラベル)
  - [言語の扱い](#言語の扱い)
  - [セキュリティ](#セキュリティ)
  - [テスト](#テスト)
- [図表レンダリング（20-2〜20-4）](#図表レンダリング20-220-4)
  - [Mermaid（20-2）](#mermaid20-2)
  - [PlantUML（20-3）](#plantuml20-3)

## シンタックスハイライト（20-1）

### ライブラリの選定

`rehype-highlight`（内部は lowlight / highlight.js）を react-markdown の rehype プラグインとして使う。

| 観点 | rehype-highlight（採用） | Shiki | Prism（react-syntax-highlighter） |
|---|---|---|---|
| 組み込み方 | react-markdown のプラグイン。構文木（hast）のまま描画 | HTML 文字列を返す。埋め込むか hast への変換層が要る | 独自コンポーネントで描画 |
| 処理 | 同期。ストリーミング中の 1 文字ごとの再描画に追従できる | 非同期で重い（文法・テーマの読み込み） | 同期 |
| 配色 | クラス（`.hljs-*`）に CSS で色を付ける。テーマ変数で 3 テーマに追従 | テーマごとにインラインの色。3 テーマ分を別に用意する | テーマのオブジェクトを JS で渡す |
| 色付けの品質 | 中（正規表現ベース） | 高（VS Code と同じ文法） | 中 |

チャットの応答はストリーミングで少しずつ届き、そのたびに Markdown 全体を描画し直す。非同期の Shiki は届くたびに色付けをやり直す負荷が大きく、HTML 文字列の埋め込みは XSS の方針（生の HTML 禁止）にも反する。色付けの品質より、同期処理であることとテーマ変数で色を付けられることを優先した。

登録する言語は lowlight の `common`（約 37 言語）。要件の bash / javascript / typescript / java / go / python / rust / SQL / JSON / YAML / HTML（`xml`）/ CSS はすべて含まれ、`ts`・`js`・`py`・`sh`・`yml`・`html` などの別名も highlight.js の定義で解決される。

### 描画の流れ

```
Markdown（応答の本文）
  → remark-gfm（mdast）
  → mdast-util-to-hast        … コードフェンスの言語を code の className（language-xxx）に入れる
  → rehype-highlight          … code の中身をトークンごとの span（.hljs-keyword 等）に置き換え、先頭に hljs クラスを足す
  → components.pre / code     … MarkdownContent.tsx で見出し行（言語名・コピー）と pre を描画
```

- `components.code` は **className の有無**でブロックかインラインかを分ける。className はコードフェンスに言語を書いたブロックにだけ付く。rehype-highlight が先頭に `hljs` を足すため、`language-` で始まるかでは判定できない。
- 言語を書いていないブロックは className が無く、インラインコードと同じ見た目で描画される。そのため `pre` 側の子孫セレクタ（`[&_code]:...`）で枠・背景・色を打ち消す。
- コピーする本文は `pre` の構文木の文字列を連結して作る（`lib/chat/code-block.ts` の `hastToText`）。色付けで本文が span に分かれても、連結すれば元に戻る。

### 配色（テーマ対応）

`globals.css` の `.hljs-*` に、既存のテーマ変数で色を付ける。変数経由のため、テーマを切り替えるとハイライトの色もそのテーマの色になる。割り当ては Nord 公式の highlight.js テーマに合わせた。

| トークン（主なクラス） | 変数 | Nord での色 |
|---|---|---|
| キーワード・リテラル・タグ名（`keyword` / `literal` / `name`） | `--color-nord-frost-2` | #81a1c1 |
| 型・組み込み・属性（`type` / `built_in` / `attr`） | `--color-nord-frost-0` | #8fbcbb |
| 関数名・クラス名（`title`） | `--color-nord-frost-1` | #88c0d0 |
| 文字列（`string`） | `--color-nord-aurora-green` | #a3be8c |
| 数値（`number`） | `--color-nord-aurora-purple`（追加） | #b48ead |
| 正規表現・記号（`regexp` / `symbol`） | `--color-nord-aurora-yellow` | #ebcb8b |
| メタ・デコレーター（`meta`） | `--color-nord-aurora-orange`（追加） | #d08770 |
| コメント（`comment`） | `--color-nord-4` の 60%・斜体 | — |
| 地の文字 | `--color-nord-6`（`pre` の文字色） | #eceff4 |

オレンジと紫は既存のテーマ変数に無かったため、3 テーマすべてに `--color-nord-aurora-orange` / `--color-nord-aurora-purple` を追加した。**テーマを追加するときはこの 2 色も定義する**（`.claude/rules/frontend.md`）。

### 言語名ラベル

コードブロックの上端に見出し行を置き、右側に言語名とコピーボタンを並べる。

- 言語名はコードフェンスに**書かれたまま**表示する（`ts` は `ts`）。`lib/chat/code-block.ts` の `getCodeLanguage` が `code` 要素の `language-xxx` クラスから取り出す。
- 見出し行は `pre` の外に置く。横スクロールしてもラベルとコピーボタンが本文に重ならない。

### 言語の扱い

| ケース | 色付け | ラベル | 理由 |
|---|---|---|---|
| 登録済みの言語（`typescript` 等） | する | 出す | — |
| highlight.js に無い言語（`mermaid` 等） | しない（本文をそのまま表示） | 出す | rehype-highlight は未登録の言語を警告として記録するだけで、例外を投げない |
| 言語の指定なし | しない | 出さない | 自動判定は短いコードで誤判定しやすく、ストリーミング中も描画のたびに判定の計算が走るため使わない |
| 閉じていないコードフェンス（生成途中） | する | 出す | 閉じていなくても Markdown はコードブロックとして扱い、届いた分だけ色付けする |

### セキュリティ

- rehype-highlight は構文木（hast）を書き換えるだけで、HTML 文字列を作らない。react-markdown が hast を React 要素に変換するため、コード内の `<script>` や `onerror` はタグとして解釈されず、文字のまま表示される（`dangerouslySetInnerHTML` は使わない）。
- 色は CSS クラスで付けるため、インラインの `style` 属性も生成しない（CSP の `style-src` に影響しない）。

### テスト

| 層 | ファイル | 内容 |
|---|---|---|
| UT | `tests/unit/code-block.test.ts` | 言語名の取り出し（`hljs` 付き・未登録の言語・指定なし・想定外の形）と、span に分かれた本文の連結 |
| E2E | `tests/e2e/syntax-highlight.spec.ts` | トークンの色がテーマ変数と一致・テーマ切替への追従・言語指定なし・未登録の言語・インラインコード・HTML のタグが実行されない・閉じていないフェンス |

応答は API で投入する（モデルがどの言語のコードブロックを出すかは決まらないため）。コードブロックのコピーは既存の `copy.spec.ts` が、色付け後の本文でも検証している。

## 図表レンダリング（20-2〜20-4）

Mermaid（20-2 / #169）・PlantUML（20-3）・図表の共通 UI（20-4）は、それぞれ #13 のサブ issue として起票してから設計する。方式の候補は #13 の「技術的な検討事項」を参照。20-4 は未着手。

### Mermaid（20-2）

#### 範囲

| 含める | 含めない（別の段階） |
|---|---|
| ` ```mermaid ` のブロックを図として描く・テーマの色で描きテーマの切り替えに追従する・描けないときはソースを表示する | PlantUML（20-3）、ズーム・PNG/SVG での保存・ソースとの切り替え（20-4） |

#### ライブラリと読み込み

- `mermaid` を `dependencies` に追加した（`^12.1.0`。lockfile で 12.1.0 に固定）。公開から 2 週間以上たった版を選んだ（2026-10-25 時点。12.2.0 は 2026-10-13 公開のため見送った）。
- **Mermaid のブロックが現れたときだけ `import('mermaid')` で読み込む。** mermaid は依存（d3・cytoscape・katex 等）を含めて大きく、図を使わない会話の初回の読み込みに乗せない。2 回目以降はモジュールのキャッシュを使う。

#### 描画の流れ

```
components.pre（MarkdownContent.tsx）
  └ getDiagramKind(言語名) が 'mermaid' か（大文字小文字は区別しない）
      ├ 違う → 今までどおりのコードブロック（PlantUML は下の節）
      └ そう → MermaidCodeBlock（organisms。MarkdownContent.tsx 内）
            └ useMermaidDiagram（hooks/chat/）→ 状態を DiagramView（molecules）に渡す
                 1. 生成中なら何もしない（ソースのまま表示）
                 2. import('mermaid') → initialize（テーマの色・securityLevel 等）
                 3. mermaid.render(id, ソース) → SVG の文字列
                 4. SVG を data: URI にして <img src> に入れる
```

- 見出し行（言語名 `mermaid`・ソースのコピー）は今のコードブロックと同じものを残し、本文の `pre` を図に置き換える。コピーはソースを写す（図の保存は 20-4）。
- 描き終わるまではソースを表示し、描けたら図に差し替える。読み込み中の表示を別に作らない。
- `mermaid.render` の `id` は SVG の要素 ID になるため、`useId` の値から英数字以外を落として `mermaid-` を前に付ける（`toMermaidId`）。同じ画面に図が複数あっても重ならない。
- mermaid の SVG は `width="100%"` と `style="max-width: …"` で出てくる。`<img>` に入れると元の大きさが決まらず 300×150 で描かれるため、ルートの `<svg>` に `viewBox` の幅・高さを `width` / `height` として書き込む（`withIntrinsicSize`）。

#### 生成中は描かない

**応答の生成が終わってから描く。** 生成中はブロックの中身が 1 文字ずつ増え、そのたびに描くと、書きかけの構文で描画のエラーが連続し、重い描画が何十回も走る。

- `MarkdownContent` に `isStreaming`（省略時 `false`）を足し、`ChatWindow` が生成中の応答にだけ `true` を渡す（`isLoading` かつ最後の assistant メッセージ）。
- `MarkdownContent` の中では、`isStreaming` を props ではなく Context で `components.pre` に届ける。`components` を描画のたびに作り直すと React が別のコンポーネントとみなし、図を毎回作り直して描き直すため、`components` はモジュールの定数のままにする。
- 生成中の Mermaid のブロックは、20-1 と同じく「色付けなし・ラベルあり」のソースで表示する。生成が終わった時点で描画する。
- 保存済みの応答（会話を開いたとき）は最初から描く。

#### 図の埋め込み方（`<img>` の data: URI）

`mermaid.render` は SVG を**文字列**で返す。公式の例のように `innerHTML` で埋め込むと「生の HTML を埋め込まない」方針（`.claude/rules/security.md`）に反するため、**SVG を `data:image/svg+xml` の URI にして `<img>` で表示する**（`svgToDataUri`）。

| 観点 | `<img>` の data: URI（採用） | `innerHTML` / `dangerouslySetInnerHTML` |
|---|---|---|
| スクリプト | `<img>` の中の SVG はスクリプト・イベント属性を実行しない | mermaid の消毒（DOMPurify）が漏れると実行される |
| 外部の読み込み | 画像としての SVG は外部の画像・CSS・フォントを読み込まない | 読み込む |
| CSP | 変更不要（`img-src 'self' data:` が既にある） | 変更不要 |
| テーマの CSS 変数 | 届かない（別の文書になる）→ 描画時に値を読んで渡す | 届く |
| Web フォント（Geist） | 届かない → システムフォントで描く | 届く |
| 図の中の文字の選択・リンク | できない | できる |

文字の選択・図の中のリンクより、消毒に頼らずにスクリプトを止められることを優先した。リンク（`click` 文）は下の `securityLevel: 'strict'` でも無効になるため、失うものは文字の選択だけになる。

#### mermaid の設定

| 設定 | 値 | 理由 |
|---|---|---|
| `startOnLoad` | `false` | ページの `.mermaid` 要素を勝手に探して描かせない |
| `securityLevel` | `'strict'` | ラベルの HTML を消毒し、`click` 文を無効にする（`<img>` と二重の防御） |
| `htmlLabels` | `false` | ラベルを `foreignObject`（HTML）ではなく SVG の `text` で描く。画像としての SVG で HTML のラベルに頼らない |
| `theme` | `'base'` | `themeVariables` だけで配色を決められる唯一のテーマ |
| `themeVariables` | 下の表 | テーマの色で描く |
| `fontFamily` | `Arial, Helvetica, sans-serif` | mermaid はページの中で文字の幅を測ってから枠の大きさを決める。`<img>` の中では Geist が使えないため、測る側も描く側もシステムフォントに揃えないと、文字が枠からはみ出す（本文の `font-family` から Geist を除いたもの） |

`initialize` はページ全体の設定のため、描く直前に毎回、そのときのテーマの色で呼ぶ。`render` は mermaid の中で 1 つずつ順に実行される。図ごとに別のテーマで描くことは無いため、`initialize` と `render` の間に別の図の `initialize` が入っても結果は変わらない。

#### 配色（テーマ対応）

描く直前に `getComputedStyle(document.documentElement)` でテーマの CSS 変数の値を読み、`themeVariables` に渡す（`buildMermaidThemeVariables`。読み取りの関数を引数で受け、UT では表を渡す）。

| mermaid の変数 | テーマの変数 | 用途 |
|---|---|---|
| `background` | `--color-nord-0` | 図の地（コードブロックと同じ） |
| `primaryColor` | `--color-nord-2` | ノードの塗り |
| `primaryBorderColor` | `--color-nord-frost-1` | ノードの枠 |
| `primaryTextColor` / `textColor` | `--color-nord-6` | 文字 |
| `lineColor` | `--color-nord-frost-2` | 線・矢印 |
| `secondaryColor` / `tertiaryColor` | `--color-nord-1` / `--color-nord-3` | サブグラフ・2 番目以降の塗り |
| `noteBkgColor` / `noteTextColor` | `--color-nord-aurora-yellow` / `--color-nord-0` | 注記 |
| `errorBkgColor` | `--color-nord-aurora-red` | 図の中のエラー表示 |

- **テーマの切り替えに追従する。** テーマは `<html>` の `data-theme` 属性で決まる（`useTheme`）。`useMermaidDiagram` は `MutationObserver` で `data-theme` の変化を見て描き直す。`useTheme` を図ごとに呼ぶと、図ごとに別のテーマの状態を持ってしまうため使わない。
- 描き直している間は前のテーマの図を出しておく（ソースに戻すとちらつくため）。ソースが変わったときだけ、描き終わるまでソースを表示する。
- テーマを追加するときは、上の表の変数がそのテーマにも定義されていれば図も追従する（新しい変数は増やさない）。

#### 描けないとき

| ケース | 表示 |
|---|---|
| 構文の誤り（`mermaid.render` が例外） | ソースのコードブロックをそのまま表示し、下に「図を描けませんでした: <mermaid のメッセージ>」を添える |
| 空のブロック | 描かず、空のコードブロックのまま（エラーも出さない） |
| `maxTextSize`（既定 50,000 文字）を超える | mermaid が例外を投げるため、構文の誤りと同じ |
| `import('mermaid')` の失敗（チャンクの取得失敗など） | 構文の誤りと同じ表示 |

失敗はコンソールにも出す（`console.error`）。応答の本文・保存・コピーには影響しない。

#### 表示

- 図はコードブロックと同じ枠（`bg-nord-0`・`border-nord-3`）の中に、中央寄せで置く。`max-width: 100%`・高さは自動で、幅の広い図は縮めて収める（拡大は 20-4）。
- `<img>` の `alt` は「Mermaid の図」。図の中身を文字で説明する手段は 20-4 のソース表示で補う。

#### 配置

| ファイル | 内容 |
|---|---|
| `lib/chat/diagram.ts` | 純粋な関数: `getDiagramKind`・`toMermaidId`・`svgToDataUri`・`withIntrinsicSize`・`buildMermaidThemeVariables`（PlantUML の `toPlantUmlDiagramState` も同居） |
| `types/chat/diagram.ts` | `DiagramKind`・`DiagramState`（`idle` / `rendered` / `error`） |
| `hooks/chat/useMermaidDiagram.ts` | mermaid の読み込み・初期化・描画・テーマの追従。`DiagramState` を返す |
| `components/features/chat/molecules/DiagramView.tsx` | 状態に応じて図またはソース・エラーを表示（フックを呼ばない） |
| `components/features/chat/organisms/MarkdownContent.tsx` | `pre` で図の種類を分岐し、`MermaidCodeBlock` がフックを呼ぶ。`isStreaming` を Context で届ける |
| `components/features/chat/organisms/ChatWindow.tsx` | 生成中の応答に `isStreaming` を渡す |

#169 の時点では、フックを呼ぶ `MermaidDiagram` を molecules に置いていた。molecules はドメインのフックを持たない（`docs/12`）ため、#171 で表示だけの `DiagramView` に改名し、フックの呼び出しを organisms へ移した（下の「Mermaid の部品の階層の是正」）。

#### Mermaid のセキュリティ

- SVG は `<img>` の data: URI で表示し、DOM に HTML・SVG を直接入れない（`dangerouslySetInnerHTML` を使わない）。画像としての SVG はスクリプトを実行せず、外部の資源も読み込まない。
- そのうえで `securityLevel: 'strict'` で mermaid にもラベルを消毒させ、`click` 文を無効にする。
- CSP は変えない。mermaid は描画のときに一時的な要素と `<style>` をページに足すが、`style-src 'unsafe-inline'` で許可済み。
- `docs/05-security.md`・`.claude/rules/security.md` の XSS 対策に、「SVG の文字列を返すライブラリは `<img>` の data: URI で表示する」を足す。

#### Mermaid のテスト

| 層 | ファイル | 内容 |
|---|---|---|
| UT | `tests/unit/diagram.test.ts` | `getDiagramKind`（大文字・別の言語・`null`・継承したプロパティ名）、`toMermaidId`（`useId` の記号を落とす・空にならない）、`svgToDataUri`（`#`・`%`・日本語・改行を含む SVG を `decodeURIComponent` で戻せる）、`withIntrinsicSize`（`viewBox` の大きさの書き込み・既存の `width` / `height` の置き換え・`viewBox` が無い／壊れている SVG はそのまま）、`buildMermaidThemeVariables`（変数の対応・値の前後の空白・未定義の変数） |
| E2E | `tests/e2e/diagram.spec.ts` | 正常系: 保存済みの応答の図が `<img>` で表示され、SVG にノードの文字が入る／ソースをコピーできる／図が 2 つあっても両方描ける／テーマを切り替えると色が変わる／ストリーミングの応答（`page.route` で `/api/chat` を差し替え）が終わると図になる。準正常系: 構文の誤り→ソースとエラーの表示／空のブロック／`Mermaid`（大文字）。異常系: ラベルの `<img onerror>`・`click` 文が実行されない／図の失敗が他のメッセージの表示を壊さない |

- 応答は 20-1 と同じく API で投入する（モデルが Mermaid を出すかは決まらないため。軽量モデル・CI でも動く）。
- ストリーミングの応答だけは `page.route` で `/api/chat` の応答を差し替える（通信の境界の障害注入。`.claude/rules/testing.md`）。
- 図の画素を比べるスクリーンショットは足さない（フォントの描画が環境で変わり、基準画像が安定しないため）。色の追従は `<img src>` の SVG に入ったテーマの色の値で確かめる。

### PlantUML（20-3）

#### 範囲

| 含める | 含めない（別の段階） |
|---|---|
| ` ```plantuml ` / ` ```puml ` のブロックを図として描く・PlantUML サーバーの導入（`docker-compose.yml`・CI）・描けないとき／サーバーに繋がらないときはソースを表示する・Mermaid の部品の階層の是正（下記） | ズーム・PNG/SVG での保存・ソースとの切り替え（20-4） |

#### 描画方式の選定

| 観点 | Docker の PlantUML サーバー（採用） | WASM（ブラウザ内） | 外部の公開サーバー |
|---|---|---|---|
| ローカル完結 | する | する | しない（応答の内容を外へ送る） |
| 既存の構成との整合 | SearXNG と同じく `docker-compose.yml` のサービスにできる | 新しい仕組み（大きな WASM の配布） | — |
| 成熟度 | 公式イメージ・公式の HTTP API | 版が古く、日本語・図の種類の対応に懸念 | — |
| 費用 | Java のコンテナ（常駐で約 340MB。実測） | ブラウザで重い初回読み込み | — |

公式イメージ `plantuml/plantuml-server` の **`jetty-v1.2026.8`** に固定する（公開から 2 週間以上たった版。2026-10-25 時点の最新 v1.2026.9 は 2026-10-18 公開のため見送る）。

#### セキュリティ（SANDBOX）

PlantUML の既定の設定では、`!include https://…` で**サーバーが外部の URL を取りに行く**（実測: 取得して描画に成功した）。応答の本文はモデルが書いたもので、Web 検索・URL 取得の結果に紛れた指示から作られることもある。そのため、応答に含まれる URL を PlantUML サーバーに取りに行かせない。

- コンテナに **`PLANTUML_SECURITY_PROFILE=SANDBOX`** を渡す。実測で次を確かめた:

| 書いたもの | 既定 | SANDBOX |
|---|---|---|
| `!include https://…`（外部の URL） | 取りに行き、描画できる | 「Cannot open URL」で失敗 |
| `!include /etc/passwd`（コンテナ内のファイル） | 「cannot include」で失敗 | 失敗 |
| `%getenv("HOME")`（環境変数） | 空 | 空 |
| `!include <C4/C4_Container>`（同梱の標準ライブラリ） | 使える | 使える |

- ポートは `127.0.0.1` だけに公開する（`.claude/rules/security.md`「ローカルの補助サービス」）。
- 返ってきた SVG は Mermaid と同じく `data:image/svg+xml` の `<img>` で表示し、DOM に入れない。

#### 描画の流れ

```
components.pre（MarkdownContent.tsx）
  └ getDiagramKind(言語名) が 'plantuml' か（plantuml / puml。大文字小文字は区別しない）
      └ PlantUmlCodeBlock（organisms。MarkdownContent.tsx 内）
            └ usePlantUmlDiagram（hooks/chat/）
                 1. 生成中・空なら何もしない（ソースのまま表示）
                 2. 上限（MAX_DIAGRAM_SOURCE_LENGTH）を超えたら送らずにエラー
                 3. POST /api/diagrams/plantuml { source }
                       └ Route Handler → lib/server/plantuml.ts → PlantUML サーバーの POST /svg
                 4. { svg } を data: URI にして DiagramView（molecules）の <img> に入れる
```

- **ブラウザから PlantUML サーバーへ直接つながない。** Route Handler を経由する（フロントは外部へ直接通信しない。CSP の `connect-src 'self'` もそのまま）。
- ソースはそのまま送る。`@startuml` / `@enduml` を書かないブロックも、PlantUML サーバーが補って描く（実測）。`@startmindmap` などの別の図もそのまま描ける。1 つのブロックに図が 2 つあれば、最初の図だけを描く（PlantUML サーバーの動作）。
- 生成中は描かない・描けるまではソースを表示する・`useId` は使わない（サーバーで描くため ID が要らない）。前のリクエストは、ソースが変わったとき・アンマウントしたときに `AbortController` で止める。

#### API: `POST /api/diagrams/plantuml`

| 項目 | 内容 |
|---|---|
| リクエスト | `{ source: string }`（`lib/server/request-body.ts` の `parsePlantUmlBody`。空白だけ・文字列でない・`MAX_DIAGRAM_SOURCE_LENGTH`（50,000 文字。mermaid の `maxTextSize` と同じ）超は 400） |
| 200 | `{ svg: string }` |
| 400 | 入力の誤り、または PlantUML が描けなかった（構文の誤り・SANDBOX で止めた include 等）。`error` は PlantUML の `X-PlantUML-Diagram-Error` と行番号から作る（例: `Syntax Error? (Assumed diagram type: sequence)（2 行目）`） |
| 502 | PlantUML サーバーに繋がらない・10 秒（`PLANTUML_TIMEOUT_MS`）で応答しない・想定外の応答。`error` は「PlantUML サーバーに接続できませんでした。`docker compose up -d` で起動してください」等 |

- エラーの形は既存と同じ `{ error: string }`。
- 接続先は環境変数 **`PLANTUML_URL`**（既定 `http://localhost:8889`）。`lib/server/plantuml.ts` だけが読む（`SEARXNG_URL` と同じ扱い）。
- `request.signal` を PlantUML への `fetch` に渡し、ブラウザが去ったら止める（`.claude/rules/api.md`）。
- 返す SVG の大きさは、入力の上限（50,000 文字）と PlantUML の画像の上限（既定 4096px）で抑えられるため、受信の上限は別に設けない。

#### 配色

**PlantUML の既定の見た目（白い地）のまま描き、テーマには追従させない。** 図の種類（シーケンス図・クラス図・アクティビティ図・マインドマップ等）ごとに `skinparam` が分かれていて、一部の種類だけ暗い色に上書きすると、上書きしていない要素が白いまま残って崩れる。応答に `!theme` や `skinparam` が書かれていれば、それがそのまま効く（こちらで上書きしない）。

#### 描けないとき

| ケース | 表示 |
|---|---|
| 構文の誤り・SANDBOX で止めた include（400） | ソース + 「図を描けませんでした: <PlantUML のメッセージ>（N 行目）」 |
| サーバーに繋がらない・時間切れ（502） | ソース + 「図を描けませんでした: PlantUML サーバーに接続できませんでした。…」 |
| 空のブロック | 描かず、空のコードブロックのまま（エラーも出さない） |
| 上限を超える | 送らずに、ソース + 「図を描けませんでした: 図のソースが長すぎます（上限 50,000 文字）」 |

#### Mermaid の部品の階層の是正

`docs/12-ui-components.md` の「階層の判断基準」では、molecules は**ドメインのフックを持たない**。#169 の `MermaidDiagram`（molecules）は `useMermaidDiagram` を呼んでいて、これに反していた。PlantUML でも同じ形の部品が要るため、ここで次の形に揃える。

| 部品 | 階層 | 役割 |
|---|---|---|
| `DiagramView`（`MermaidDiagram` を改名して中身を表示だけにする） | molecules | 描画の状態（`DiagramState`）・代わりのソース・`alt` を受け取り、図の `<img>` かソース + エラーを出す。フックを呼ばない |
| `MermaidCodeBlock`・`PlantUmlCodeBlock` | organisms（`MarkdownContent.tsx` 内） | 生成中かを Context から読み、それぞれのフックを呼んで `DiagramView` に渡す |

- 描画の状態の型 `DiagramState`（`idle` / `rendered` / `error`）は 2 つのフックと `DiagramView` から参照されるため、`types/chat/diagram.ts` に置く（`typescript.md`「2 箇所目で昇格」）。
- `isMermaidLanguage` は `getDiagramKind`（`'mermaid' | 'plantuml' | null`）に置き換える。

#### 導入（Docker・CI・環境変数）

- `docker-compose.yml` に `plantuml` サービスを足す（イメージの固定・`PLANTUML_SECURITY_PROFILE: SANDBOX`・`127.0.0.1:8889:8080`）。`docker compose up -d` で PostgreSQL・SearXNG と一緒に起動する。
- CI の E2E（`e2e-test.yml`）の `services:` にも同じイメージ・設定で足す。`services:` のイメージは Dependabot の対象外のため、手動で更新する（`.claude/rules/github-actions.md`）。
- `front/.env.example` に `PLANTUML_URL` を足し、環境変数の一覧（`CLAUDE.md`・`README.md`・`README.en.md`・`docs/02`・`manuals/setup-guide-macos.md`）とポートの重複表（`.claude/rules/documentation.md`）を同期する。
- E2E の `global-setup.ts` で PlantUML サーバーに繋がるかを確かめ、繋がらなければ開始前に止める（起動し忘れで PlantUML の E2E だけが分かりにくく落ちないように）。

#### PlantUML のテスト

| 層 | ファイル | 内容 |
|---|---|---|
| UT | `tests/unit/diagram.test.ts` | `getDiagramKind`（`plantuml`・`puml`・大文字・別の言語・`null`）、`toPlantUmlDiagramState`（成功の `svg`・失敗の `error`・想定外の形） |
| UT | `tests/unit/plantuml.test.ts` | PlantUML のエラーの見出しと行番号からメッセージを作る処理（行番号なし・不正な値） |
| UT | `tests/unit/request-body.test.ts`（追記） | `parsePlantUmlBody`（空白だけ・非文字列・上限ちょうど／超え） |
| IT | `tests/integration/plantuml.test.ts` | Route Handler を PlantUML のスタブ（`stubFetch`）で: 200 の中継／入力の誤り→400／PlantUML の 400→400 とメッセージ／接続失敗・時間切れ・想定外の状態→502／ソースをそのまま POST していること |
| E2E | `tests/e2e/diagram.spec.ts`（追記） | 実際の PlantUML サーバーで: シーケンス図が `<img>` で描かれる／`@startuml` なしでも描ける／`puml`。準正常系: 構文の誤り→ソースとエラー／空のブロック。異常系: `!include https://…` が SANDBOX で止まりエラーになる／サーバーの失敗（`page.route` で 502 を注入）でもソースとエラーを出し、他の表示を壊さない |
