# UI コンポーネント 設計書（Atomic Design）

> 最終更新: 2026-10-26

フロントの UI コンポーネントを Atomic Design（atoms / molecules / organisms / templates / pages）で整理する設計（#163）。置き場所・依存の向き・各部品の props の方針と、移行の段階を定める。移行は段階 4 で完了した（`src/features/` は無い）。

## 目次

- [背景](#背景)
- [方針](#方針)
- [ディレクトリ構成](#ディレクトリ構成)
- [階層の判断基準](#階層の判断基準)
- [依存の向き](#依存の向き)
- [共通の atoms](#共通の-atoms)
- [共通の molecules](#共通の-molecules)
- [機能ごとの部品](#機能ごとの部品)
- [templates・page](#templatespage)
- [モーダルの実装](#モーダルの実装)
- [確認方法](#確認方法)
- [移行の段階](#移行の段階)

## 背景

2026-10-24 時点の棚卸し。

- 素の `<button>` が約 27 か所にあり、同じ Tailwind のクラスが繰り返されている。見た目を揃えて変えるには、全箇所を直す必要がある。

  | 種類 | 現状 |
  |---|---|
  | 主ボタン（`bg-nord-frost-1`） | 3 か所。余白（`px-4` / `px-6`）が少しずつ違う |
  | 副ボタン（背景なし） | 「キャンセル」「さらに表示」等 |
  | アイコンボタン | `p-1.5` / `p-2 rounded-lg text-nord-4/60 hover:bg-white/5` が 5 か所以上 |
  | 切り替えの小ボタン | `aria-pressed` 付きが 2 か所（役割のプリセット等） |
  | スイッチ | 設定のツールの ON/OFF（`w-11 h-6 rounded-full`） |
  | 入力欄 | 検索欄・役割の入力欄・モデル選択（ヘッダー・設定の 2 か所） |
  | 小さな丸 | 生成中の印・接続状態の緑の点・読み込み中の 3 点 |
  | 強調 | 検索結果の `<mark>` |

- モーダルの作りが 3 通りある。`SettingsModal`（`role="dialog"` の自前実装）・`RoleDialog`（ネイティブの `<dialog>` + `showModal()`）・`SidebarDrawer`（`role="dialog"` + `useDrawerDialog`）。フォーカス・Escape・背景のクリックの挙動が揃っていない。
- 1 つのコンポーネントの中に小さな部品が同居している（`ConversationSearch` の `Highlighted`、`ToolCallResult` の `WebSearchResult` 等）。

## 方針

- **見た目・挙動を変えない整理を基本とする。** 挙動が変わる箇所（設定モーダルを `<dialog>` に揃える）は、PR で明示する。
- **層 → 機能 → 階層の順に分ける。** #160 の規則（`src/<層>/<機能>/`）に揃え、機能の部品は `src/components/features/<機能>/<階層>/` に置く。どの機能にも属さない共通の部品は `src/components/common/<階層>/` に置く。`components/` の下は、共通（`common/`）も機能（`features/<機能>/`）も「区分 → 階層」の同じ形になる。
- **`src/features/` はなくした**（段階 4）。部品は `components/features/<機能>/<階層>/`、フックは `hooks/<機能>/`、定数は `constants/<機能>/` に置く。
- Storybook は入れない（部品の数が少なく、依存と保守が増える割に効果が小さい）。

## ディレクトリ構成

段階 4 の完了時の形。

```
src/
├── app/                        # page（app/page.tsx）・Route Handlers
├── components/
│   ├── common/                 # 共通の部品（ドメインを知らない）。中は Atomic Design の階層で分ける
│   │   ├── atoms/              # 最小の部品（Button・IconButton …）
│   │   ├── molecules/          # atoms を組み合わせた部品（SearchBox・Modal …）
│   │   └── templates/          # 画面の枠。中身は props（ReactNode）で受け取る（ChatLayout）
│   └── features/               # 機能ごとの部品。中は Atomic Design の階層で分ける
│       ├── chat/
│       │   ├── molecules/      # その機能専用の組み合わせ（ToolCallIndicator …）
│       │   └── organisms/      # その機能の大きな部品（ChatWindow・ChatBar …）
│       ├── sidebar/
│       │   ├── molecules/
│       │   └── organisms/
│       └── settings/
│           └── organisms/
├── constants/<機能>/            # 機能内で共有する・機能をまたぐ定数（例: constants/chat/toolLabels.ts）
├── hooks/<機能>/                # カスタムフック（例: hooks/chat/useChat.ts）
├── lib/<機能>/                  # ロジック・外部連携（#160）
├── types/<機能>/                # 機能をまたぐ型（#160）
└── generated/                  # Prisma の生成物
```

- `components/features/<機能>/` の中に置ける階層は `atoms`・`molecules`・`organisms`。templates は画面全体の枠なので共通（`components/common/templates/`）にだけ置く。
- `settings` は organisms（`SettingsModal`）だけを持つ。選択カードなどの小さな部品は、今は `SettingsModal` の中にしか無いため切り出していない。
- **空の階層のディレクトリは作らない。** 部品ができたときに作る（今の各機能に機能専用の atoms は無い）。
- `components/` の直下は `common/` と `features/` だけにする。部品は各階層のディレクトリの直下に置く。re-export だけの `index.ts`（barrel）は作らない。

## 階層の判断基準

| 階層 | 置き場所 | 持ってよいもの | 持たないもの |
|---|---|---|---|
| atoms | `components/common/atoms/`・`components/features/<機能>/atoms/` | 見た目の variant・size、素の要素の props | 他の部品・ドメインのフック・API 通信 |
| molecules | `components/common/molecules/`・`components/features/<機能>/molecules/` | atoms の組み合わせ、UI だけの状態（開閉・入力中の値） | ドメインのフック・API 通信 |
| organisms | `components/features/<機能>/organisms/` | ドメインの型・props、機能のフックの戻り値、atoms・molecules | templates |
| templates | `components/common/templates/` | 画面の枠（配置・余白・レスポンシブ）。中身は props で受け取る | ドメインの型・organisms の import |
| page | `app/page.tsx` | フックの呼び出し、フック間の繋ぎ、template と organisms の組み立て | API 通信・ドメインのロジック（`frontend.md`） |

- **共通か機能専用か**: 「別のアプリにそのまま持っていけるか」。持っていけるなら共通（`components/common/<階層>/`）、このアプリの会話・メッセージ・ツールを知っているなら機能専用（`components/features/<機能>/<階層>/`）。
- 機能専用の atoms・molecules は、ドメインの型（`Message` 等）を props に取ってよい。共通の atoms・molecules は取らない。
- 機能専用の部品が 2 つ目の機能から必要になったら、ドメインの知識を外して共通の階層へ移す（型・定数の「2 箇所目で昇格」と同じ考え方）。

## 依存の向き

```
共通 atoms ← 共通 molecules ← 機能の atoms ← 機能の molecules ← 機能の organisms ← page
                              共通 templates ← page
```

- 下の階層は上の階層を import しない。
- 共通の部品（`components/common/{atoms,molecules,templates}/`）は、`components/features/**` とドメインのフック（`hooks/<機能>/`）を import しない。
- **機能の部品は、他の機能の部品を import しない**（`components/features/chat/**` から `components/features/sidebar/**` を import しない）。機能をまたいで使うものは共通の階層へ移す。2026-10-24 時点で、機能の間の import は無い。
- organisms は templates を import しない（組み立ては page が行う）。
- **ESLint の `no-restricted-imports` で機械的に強制する**（段階 2 で `eslint.config.mjs` にディレクトリごとの設定を入れた。追加の依存は不要）。移行中だけ置いていた `src/features/` 向けの設定は、段階 4 で外した。

## 共通の atoms

共通の作り方:

- 素の要素の props（`ComponentProps<'button'>` 等）を受け、見た目は `variant`・`size` の union リテラルで選ぶ（`enum` は使わない。`typescript.md`）。
- 色はテーマの CSS 変数（`nord-*`）だけを使う。3 テーマに追従させるため。
- 外から渡す `className` は配置（余白・幅・位置）に限る。色を上書きして variant を崩さない。
- React 19 では `ref` を通常の props として受け取れるため、`forwardRef` は使わない。
- クラス名の連結は小さな関数（`lib/shared/class-names.ts` の `cn`）で行い、`clsx` 等のライブラリは入れない。Tailwind のクラスの衝突は解決しないため、`className` で渡すクラスと atoms の見た目のクラスが同じ性質を指定しないようにする（例外: `TextInput` の左右の余白 `px-3` は、アイコンを置く `pl-9 pr-9` が後から当たって上書きする。計算値で確かめた）。
- アクセシビリティの必須項目を props で強制する（アイコンだけのボタンは `label` 必須など）。

段階 2 で作った atoms（`components/common/atoms/`）:

| 部品 | props | 使っている箇所 |
|---|---|---|
| `Button` | `variant: 'primary' \| 'secondary' \| 'subtle' \| 'link'`・`size: 'sm' \| 'md' \| 'lg'`（`link` は余白なし）。`type` の既定は `'button'` | 保存・Close（`primary`）、キャンセル（`secondary`）、さらに表示（`subtle`）、再試行・再送・再生成（`link`） |
| `IconButton` | `label`（必須。`aria-label` になる）・`tone: 'muted' \| 'default' \| 'danger' \| 'primary' \| 'inherit'`・`size: 'xs' \| 'sm' \| 'md' \| 'lg'`（`inherit`・`xs` は段階 3 で追加。周りの文字色のまま余白なしで文字の並びに混ぜる）。押せないとき（`disabled`）は、`primary` 以外も薄くして hover の色を付けない（#176 で追加。それまでは見た目が変わらなかった） | 閉じる（`Modal`・ドロワー）・検索をやめる・設定を開く・メニューを開く（`default`）・会話の削除（`danger`）・送信と停止（`primary`・`lg`）・コピー（`inherit`・`xs`） |
| `ToggleChip` | `pressed`（`aria-pressed`） | 役割のプリセット |
| `Switch` | `checked`。**見た目だけ**（`aria-hidden`）。操作と読み上げは、ラベルごと包む呼び出し側のボタンが持つ（行全体を押せるようにするため） | 設定のツールの ON/OFF |
| `TextInput`・`TextArea`・`Select` | 素の要素の props。`Select` は `variant: 'default' \| 'compact'`（`compact` はブラウザの矢印を消す。矢印は呼び出し側が重ねる） | 検索欄・役割の入力欄・モデル選択（設定は `default`、ヘッダーは `compact`） |
| `Mark` | `children` | 検索結果の強調 |
| `StatusDot` | `tone: 'frost' \| 'green'`・`size: 'sm' \| 'md'`・`pulse`・`label`（渡すと `role="img"`、省くと飾りとして隠す） | 生成中の印・設定の選択中の印・接続状態の点 |
| `LoadingDots` | `label` | 最初のチャンク待ちの 3 点 |

置き換えに伴う見た目・挙動の差（スクリーンショットの E2E で、静止した見た目は変わらないことを確かめた）:

- アイコンボタンの hover の色・角の丸みを揃えた（設定を開く・メニューを開くに hover で文字が明るくなる効果、検索をやめるの角を `rounded-md` → `rounded-lg`）。
- アイコンボタンの `transition` は、色だけでなく opacity も含む `transition` にした（削除ボタンの表示の切り替えを滑らかに保つため）。
- 名前の無かったボタンに名前を付けた（設定モーダルの × に「閉じる」、送信ボタンに「送信」）。
- `Switch` のつまみは段階 2 で枠の右へはみ出していた（`div` を `span` にしたため、`left` の無い絶対配置の起点がボタンの中央寄せになった）。段階 3 で `left-0` を付けて直した（設定モーダルはスクリーンショットの E2E の対象外で、見落とした）。

**段階 2 で置き換えなかったもの**（その機能・その画面に固有の見た目で、共通の atoms に当たらない。履歴の行・検索結果の行は段階 4 で機能の molecules にした。残りは organisms の中に置いたまま）:

- 設定モーダルの選択カード（エージェントのプリセット・テーマ）と、ツールの ON/OFF の行
- サイドバーの「New Conversation」・履歴の行・検索結果の行
- ツールの結果・思考過程の開閉の見出し、ヘッダーの役割のボタン
- 入力欄（`ChatBar` の `textarea`。背景が透明で、送信欄の枠と一体になっている）

## 共通の molecules

段階 3 で作った molecules（`components/common/molecules/`）:

| 部品 | props | 使っている箇所 |
|---|---|---|
| `SearchBox` | `value`・`onValueChange`・`onClear`・`label`（入力欄の名前とプレースホルダー）・`clearLabel`（× の名前）と素の `<input>` の props。虫眼鏡アイコン + `TextInput` + クリアの `IconButton`。入力がある間の Escape はクリアだけにして外へ伝えない（ドロワーを閉じさせない） | `ConversationSearch` の検索欄 |
| `Modal` | `title`・`label`（省略時はタイトルを名前にする）・`onClose`・`closeDisabled`・`closeOnBackdropClick`（既定 false）・`size`（`md`（既定。`max-w-lg`）/ `wide`（画面いっぱいから 1rem ずつ引いた大きさ）。#176 で追加）・`footer`・`children`。外枠（タイトルと × ・本文・フッター）。本文だけがスクロールする | `SettingsModal`・`ExportDialog`（背景のクリックで閉じる）・`RoleDialog`（閉じない。保存中は閉じさせない） |
| `CopyButton` | `text`・`label`・`className`。コピーと結果の一時表示。中のボタンは `IconButton`（`inherit`・`xs`） | 応答・コードブロックのコピー。フック（`useCopyFeedback`）は `hooks/clipboard/`、コピー処理（`clipboard.ts`）は `lib/shared/` へ移した（チャットに依存しないため） |
| `CodeBlockFrame`（#176） | `language`（見出し行の言語名。`null` なら出さない）・`code`（コピーする原文）・`actions`（コピーの前に並べる操作）・`children`（本文）。枠と見出し行（言語名・操作・`CopyButton`） | `MarkdownContent` のコードブロック、`DiagramView`（切り替え・拡大のボタンを `actions` で渡す）。`MarkdownContent` の `pre` から切り出した |

`SettingsModal` を `Modal` に揃えたことによる差:

| 項目 | 前（`role="dialog"` の自前実装） | 後（`Modal`） |
|---|---|---|
| Escape | 閉じなかった | 閉じる |
| フォーカス | ダイアログへ移さず、閉じ込めない | 開くとダイアログへ移り、Tab で背景へ抜けない |
| 背景の操作 | 背景の要素を Tab で操作できた | 操作できない（top layer・inert） |
| 閉じた後のフォーカス | `body` に落ちる | 開いたボタン（「設定を開く」）へ戻る（`RoleDialog` も同じ） |
| 背景のクリック | 閉じる | 閉じる（中で押して背景で離した場合は閉じない） |
| 余白 | 見出し・本文・フッターが `p-6` | 見出し・フッターは `px-6 py-4`（`RoleDialog` に揃えた）、本文は `px-6 py-4` |
| 画面の端との間 | `mx-4` | 幅を `calc(100% - 2rem)` にして左右 1rem（`RoleDialog` も同じになった） |

## 機能ごとの部品

段階 4 で `components/features/<機能>/<階層>/` へ移し、機能専用の molecules を切り出した。

| 機能 | 階層 | 部品 | 移す前の場所 |
|---|---|---|---|
| `chat` | organisms | `ChatWindow`・`ChatBar`・`Header`・`Footer`・`MarkdownContent`・`RoleDialog`・`AgentThinking`・`ToolCallResult`（`ExportDialog` は #12 で追加。`AgentSteps` は #186 で追加。`MarkdownContent` には #186 で文字の大きさの `size`（`default` / `compact`）を足した） | `features/chat/components/` |
| `chat` | molecules | `ToolCallIndicator`（実行中のツール）・`WebSearchResult`（検索結果の一覧）（`DiagramView` は #169 で `MermaidDiagram` として追加し、#171 で表示だけの部品に改名。`DiagramZoomDialog` は #176 で追加。`AttachmentPreview`・`MessageImages`・`ImageZoomDialog` は #6 で追加） | `features/chat/components/`（`WebSearchResult` は `ToolCallResult` の中） |
| `chat` | atoms | `AttachButton`（#6 で追加。画像を添付するクリップのボタン） | — |
| `sidebar` | organisms | `Sidebar`（#24 で `id`・`isOpen`・`animate` を追加。隠すと幅 0・`inert`）・`SidebarDrawer`・`SidebarContent`・`ConversationSearch` | `features/sidebar/components/` |
| `sidebar` | molecules | `ConversationListItem`（履歴の 1 行。生成中の印・削除ボタン）・`SearchResultItem`（検索結果の 1 件。タイトル・抜粋の強調） | `SidebarContent`・`ConversationSearch` の中 |
| `settings` | organisms | `SettingsModal` | `components/settings/` |

切り出した molecules の props:

| 部品 | props |
|---|---|
| `WebSearchResult` | `text`（web_search の結果テキスト）。1 件も読み取れなければ元のテキストをそのまま出す |
| `ConversationListItem` | `conversation`・`isCurrent`・`isGenerating`・`alwaysShowDelete`（ドロワーでは true。デスクトップは hover・フォーカスの間だけ削除ボタンを出す）・`onSelect`・`onDelete` |
| `SearchResultItem` | `result`・`terms`（強調するキーワード）・`isCurrent`・`onSelect` |
| `DiagramView`（#169・#171・#176） | `diagram`（描画の状態 `DiagramState`。フックの戻り値）・`kind`（図の種類。`alt`・見出し・ファイル名に使う）・`language`・`code`（見出し行の言語名とコピーする原文）・`fallback`（描けるまで・描けないとき・ソースへ切り替えたときに出すソースの `pre`）。`CodeBlockFrame` で枠ごと描き、描けたときだけ切り替え・拡大のボタンを出す。切り替えとダイアログの開閉は UI の状態として持つ。フックは呼ばず、`MarkdownContent` 内の organisms（`MermaidCodeBlock`・`PlantUmlCodeBlock`）が描画のフックを呼んで渡す |
| `DiagramZoomDialog`（#176） | `kind`・`title`・`src`（SVG の data: URI）・`svg`（保存する SVG）・`onClose`。共通の `Modal`（`wide`）の中で倍率を変え（`ResizeObserver` で表示の倍率を測る）、SVG / PNG で保存する。PNG にできなかった理由はダイアログの中に出す |
| `AttachButton`（#6） | `onSelectFiles`（選んだファイルを受け取る）。共通の `IconButton` と隠した `<input type="file" accept multiple>`。受け付ける形式は `constants/chat/imageAttachment.ts`。形式の検証はしない（`useImageAttachments` に任せる） |
| `AttachmentPreview`（#6） | `images`・`preparingCount`・`errors`・`unsupportedModel`（非対応ならモデル名、対応・不明なら `null`）・`onRemove`。サムネイルと削除ボタン・準備中の枠・添付できなかった理由・非対応モデルの案内（画像を添付しているときだけ）を出す。どれも無ければ何も描かない |
| `MessageImages`（#6） | `images`（`MessageImage[]`）。高さ 120px のサムネイルを並べ、押すと `ImageZoomDialog` を開く（開閉は UI の状態として持つ）。`width` / `height` を渡して、読み込み前から枠を確保する |
| `ImageZoomDialog`（#6） | `image`・`alt`（見出しにも使う）・`onClose`。共通の `Modal`（`wide`・背景のクリックで閉じる）に、収まる大きさで画像を出す。添付画像は縮小済みのため倍率の切り替えは置かない |

- molecules は呼び出し側の状態（選択中の会話 ID・生成中の会話 ID の一覧）を受け取らず、その行についての真偽値だけを受け取る。一覧の中での判定は organisms が行う。
- 見た目・DOM は切り出す前と同じにした（クラス・要素の並びを変えていない）。

部品以外の移動先:

| 移す前の場所 | 移動先 |
|---|---|
| `features/chat/hooks/`（`useChat`） | `hooks/chat/`（`useCopyFeedback` は段階 3 で `hooks/clipboard/` へ移した） |
| `features/sidebar/hooks/`（`useConversations`・`useConversationSearch`・`useDrawerDialog`） | `hooks/sidebar/` |
| `features/chat/constants/toolLabels.ts` | `constants/chat/toolLabels.ts` |
| `app/page.tsx` のモデル一覧の取得・エージェントの設定の保存 | `hooks/chat/useModels.ts`・`hooks/settings/useAgentSettings.ts`（新規） |

## templates・page

- `ChatLayout`（`components/common/templates/`）: 画面の枠。各領域を `ReactNode` の props で受け取り、ドメインを知らない。

  | props | 置く場所 | 今の中身 |
  |---|---|---|
  | `sidebar` | 左の列 | `Sidebar`（md 以上で表示） |
  | `drawer` | 左の列の後 | `SidebarDrawer`（md 未満） |
  | `header` | メイン領域の上端 | `Header` |
  | `children` | ヘッダーの下（残りの高さ） | `ChatWindow` |
  | `notice` | 本文と入力欄の間。空なら出さない | `useChat` のエラー |
  | `composer` | 本文の下 | `ChatBar` |
  | `footer` | メイン領域の下端 | `Footer` |
  | `dialogs` | 枠の最後 | `ExportDialog`・`RoleDialog`・`SettingsModal` |

- `app/page.tsx`: フックを呼び、organisms を組み立てて `ChatLayout` へ渡す。レイアウトのクラス（`flex h-screen …`）とエラーの帯の見た目は `ChatLayout` へ移した。DOM の構造は移す前と同じ。
- `page.tsx` に残っていたモデル一覧の取得は `hooks/chat/useModels.ts`、ツール使用の有効状態とエージェントのプリセットの localStorage への保存は `hooks/settings/useAgentSettings.ts` へ移した（`frontend.md` の「ロジック分離」。localStorage のキーは変えていない）。

## モーダルの実装

**ネイティブの `<dialog>` + `showModal()` に揃える**（共通の `Modal` molecule）。

- フォーカスの閉じ込め・Escape で閉じる・背景の操作の無効化（top layer・inert）をブラウザが受け持つ。`RoleDialog` がすでにこの形。
- `SettingsModal` をこれに揃える。挙動の差（背景のクリックで閉じるか・閉じた後のフォーカスの戻り先）は PR に明示し、既存の E2E（`theme.spec.ts` 等の設定モーダルの操作）で確かめる。
- **サイドバーのドロワーは対象外。** 画面幅が広がったら閉じる・背景のスクロールを固定する、といった独自の挙動を `useDrawerDialog` が持ち、左から出るパネルの形もモーダルと違うため。

## 確認方法

- 見た目が変わらないことは、スクリーンショットの E2E（`screenshot.spec.ts`。ローカルの darwin 用の基準画像あり。CI ではスキップ）と全件の E2E で確かめる。
- UI 部品の UT は書かない（`testing.md`。E2E で担保する）。
- 依存の向きは lint で確かめる（段階 2 以降）。

## 移行の段階

各段階を 1 PR にする。どの段階でも、スクリーンショットの E2E と既存の E2E が通ること。

| 段階 | 内容 |
|---|---|
| 1 | 設計・規則（本書・`frontend.md`・`typescript.md`・`docs/02`・`CLAUDE.md`） |
| 2 | 共通の `components/common/atoms/` の追加と、素の `<button>`・入力欄・小さな丸・強調の置き換え。クラス名の連結の関数。依存の向きの lint |
| 3 | 共通の `components/common/molecules/` の切り出し（`SearchBox`・`Modal`・`CopyButton`）。`SettingsModal`・`RoleDialog` を `Modal` に揃える。モーダルの開閉の E2E（`settings-modal.spec.ts`） |
| 4 | `src/features/` をなくす（部品を `components/features/<機能>/<階層>/`、フックを `hooks/<機能>/`、定数を `constants/<機能>/` へ）。機能専用の molecules（`ToolCallIndicator`・`WebSearchResult`・`ConversationListItem`・`SearchResultItem`）を切り出す。`SettingsModal` を `components/features/settings/organisms/` へ。`ChatLayout` を作り、`page.tsx` を組み立てだけにする |
