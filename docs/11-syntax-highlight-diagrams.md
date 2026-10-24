# シンタックスハイライト・図表レンダリング 設計書

> 最終更新: 2026-10-24

AI 応答のコードブロックを言語別に色付けし（フェーズ20-1 / #144）、Mermaid / PlantUML を図表として描画する（フェーズ20-2〜20-4、未着手）ための設計。親 issue は #13。

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

未着手。Mermaid（20-2）・PlantUML（20-3）・図表の共通 UI（20-4）は、それぞれ #13 のサブ issue として起票してから設計する。方式の候補は #13 の「技術的な検討事項」を参照。

- 20-1 の結果、`mermaid` / `plantuml` のコードブロックは現在「色付けなし・ラベルあり」で表示される。図表の描画は `components.pre` で言語名（`getCodeLanguage`）を見て分岐させるのが自然な拡張点になる。
