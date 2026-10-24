# UI コンポーネント 設計書（Atomic Design）

> 最終更新: 2026-10-24

フロントの UI コンポーネントを Atomic Design（atoms / molecules / organisms / templates / pages）で整理する設計（#163）。置き場所・依存の向き・各部品の props の方針と、移行の段階を定める。

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
- **層 → 機能 → 階層の順に分ける。** #160 の規則（`src/<層>/<機能>/`）に揃え、機能の部品は `src/components/features/<機能>/<階層>/` に置く。どの機能にも属さない共通の部品は `src/components/<階層>/` に置く。
- **今の `src/features/` はなくす。** 部品は `components/features/<機能>/<階層>/`、フックは `hooks/<機能>/`、定数は `constants/<機能>/` へ移す（段階 4）。
- Storybook は入れない（部品の数が少なく、依存と保守が増える割に効果が小さい）。

## ディレクトリ構成

移行後（段階 4 の完了時）の形。

```
src/
├── app/                        # page（app/page.tsx）・Route Handlers
├── components/
│   ├── atoms/                  # 共通: ドメインを知らない最小の部品（Button・IconButton …）
│   ├── molecules/              # 共通: atoms を組み合わせた、ドメインを知らない部品（SearchBox・Modal …）
│   ├── templates/              # 共通: 画面の枠。中身は props（ReactNode）で受け取る（ChatLayout）
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

- `components/features/<機能>/` の中に置ける階層は `atoms`・`molecules`・`organisms`。templates は画面全体の枠なので共通（`components/templates/`）にだけ置く。
- **空の階層のディレクトリは作らない。** 部品ができたときに作る（今の各機能に機能専用の atoms は無い）。
- `components/` の直下・各階層の直下以外にファイルを置かない。re-export だけの `index.ts`（barrel）は作らない。

## 階層の判断基準

| 階層 | 置き場所 | 持ってよいもの | 持たないもの |
|---|---|---|---|
| atoms | `components/atoms/`・`components/features/<機能>/atoms/` | 見た目の variant・size、素の要素の props | 他の部品・ドメインのフック・API 通信 |
| molecules | `components/molecules/`・`components/features/<機能>/molecules/` | atoms の組み合わせ、UI だけの状態（開閉・入力中の値） | ドメインのフック・API 通信 |
| organisms | `components/features/<機能>/organisms/` | ドメインの型・props、機能のフックの戻り値、atoms・molecules | templates |
| templates | `components/templates/` | 画面の枠（配置・余白・レスポンシブ）。中身は props で受け取る | ドメインの型・organisms の import |
| page | `app/page.tsx` | フックの呼び出し、フック間の繋ぎ、template と organisms の組み立て | API 通信・ドメインのロジック（`frontend.md`） |

- **共通か機能専用か**: 「別のアプリにそのまま持っていけるか」。持っていけるなら共通（`components/<階層>/`）、このアプリの会話・メッセージ・ツールを知っているなら機能専用（`components/features/<機能>/<階層>/`）。
- 機能専用の atoms・molecules は、ドメインの型（`Message` 等）を props に取ってよい。共通の atoms・molecules は取らない。
- 機能専用の部品が 2 つ目の機能から必要になったら、ドメインの知識を外して共通の階層へ移す（型・定数の「2 箇所目で昇格」と同じ考え方）。

## 依存の向き

```
共通 atoms ← 共通 molecules ← 機能の atoms ← 機能の molecules ← 機能の organisms ← page
                              共通 templates ← page
```

- 下の階層は上の階層を import しない。
- 共通の部品（`components/{atoms,molecules,templates}/`）は、`components/features/**` とドメインのフック（`hooks/<機能>/`）を import しない。
- **機能の部品は、他の機能の部品を import しない**（`components/features/chat/**` から `components/features/sidebar/**` を import しない）。機能をまたいで使うものは共通の階層へ移す。2026-10-24 時点で、機能の間の import は無い。
- organisms は templates を import しない（組み立ては page が行う）。
- **ESLint の `no-restricted-imports` で機械的に強制する**（段階 2 で `eslint.config.mjs` にディレクトリごとの設定を入れる。追加の依存は不要）。

## 共通の atoms

共通の作り方:

- 素の要素の props（`ComponentProps<'button'>` 等）を受け、見た目は `variant`・`size` の union リテラルで選ぶ（`enum` は使わない。`typescript.md`）。
- 色はテーマの CSS 変数（`nord-*`）だけを使う。3 テーマに追従させるため。
- 外から渡す `className` は配置（余白・幅・位置）に限る。色を上書きして variant を崩さない。
- React 19 では `ref` を通常の props として受け取れるため、`forwardRef` は使わない。
- クラス名の連結は小さな関数（`lib/shared/` に置く）で行い、`clsx` 等のライブラリは入れない。
- アクセシビリティの必須項目を props で強制する（アイコンだけのボタンは `label` 必須など）。

| 部品 | props の案 | 置き換える箇所 |
|---|---|---|
| `Button` | `variant: 'primary' \| 'ghost'`・`size: 'sm' \| 'md'`。`type` の既定は `'button'` | 保存・キャンセル・さらに表示・新規会話 等 |
| `IconButton` | `label`（必須。`aria-label` になる）・`size`・`tone: 'default' \| 'danger'` | 閉じる・削除・設定・検索をやめる・メニュー 等 |
| `ToggleChip` | `pressed`（`aria-pressed`） | 役割のプリセット・エージェントのプリセット |
| `Switch` | `checked`・`onCheckedChange`・`label`（`role="switch"`） | 設定のツールの ON/OFF |
| `TextInput`・`TextArea`・`Select` | 素の要素の props | 検索欄・役割の入力欄・モデル選択 |
| `Mark` | `children` | 検索結果の強調 |
| `StatusDot` | `tone: 'frost' \| 'green'`・`pulse`・`label`（`role="img"`） | 生成中の印・接続状態の点 |
| `LoadingDots` | `label` | 最初のチャンク待ちの 3 点 |

## 共通の molecules

| 部品 | 内容 | 今の場所 |
|---|---|---|
| `SearchBox` | 虫眼鏡アイコン + `TextInput` + クリアの `IconButton`。Escape でクリア | `ConversationSearch` の検索欄 |
| `Modal` | ダイアログの外枠（タイトル・本文・フッター）。ネイティブの `<dialog>` で開閉・フォーカス・Escape を受け持つ | `SettingsModal`・`RoleDialog` の外枠 |
| `CopyButton` | コピーと結果の一時表示 | `features/chat/components/CopyButton.tsx`。フック（`useCopyFeedback`）とコピー処理（`lib/chat/clipboard.ts`）はチャットに依存しないため、`hooks/clipboard/`・`lib/shared/` へ移す |

## 機能ごとの部品

| 機能 | 階層 | 部品 | 今の場所 |
|---|---|---|---|
| `chat` | organisms | `ChatWindow`・`ChatBar`・`Header`・`Footer`・`MarkdownContent`・`RoleDialog`・`AgentThinking`・`ToolCallResult` | `features/chat/components/` |
| `chat` | molecules | `ToolCallIndicator`（実行中のツール）・`WebSearchResult`（検索結果の一覧。`ToolCallResult` から切り出す） | 同上 |
| `sidebar` | organisms | `Sidebar`・`SidebarDrawer`・`SidebarContent`・`ConversationSearch` | `features/sidebar/components/` |
| `sidebar` | molecules | `ConversationListItem`（履歴の 1 行。生成中の印・削除ボタン）・`SearchResultItem`（検索結果の 1 件。タイトル・抜粋の強調） | `SidebarContent`・`ConversationSearch` から切り出す |
| `settings` | organisms | `SettingsModal` | `components/settings/` |

部品以外の移動先:

| 今の場所 | 移動先 |
|---|---|
| `features/chat/hooks/`（`useChat`・`useCopyFeedback`） | `hooks/chat/`（`useCopyFeedback` は `hooks/clipboard/`） |
| `features/sidebar/hooks/`（`useConversations`・`useConversationSearch`・`useDrawerDialog`） | `hooks/sidebar/` |
| `features/chat/constants/toolLabels.ts` | `constants/chat/toolLabels.ts` |

## templates・page

- `ChatLayout`（`components/templates/`）: サイドバー（デスクトップ）・ドロワー（モバイル）・メイン領域（ヘッダー・本文・入力欄・フッター）の枠。各領域は `ReactNode` の props で受け取り、ドメインを知らない。
- `app/page.tsx`: フックを呼び、organisms を組み立てて `ChatLayout` へ渡すだけにする。今の `page.tsx` にあるレイアウトのクラス（`flex h-screen …`）は `ChatLayout` へ移す。

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
| 2 | 共通の `components/atoms/` の追加と、素の `<button>`・入力欄・小さな丸・強調の置き換え。クラス名の連結の関数。依存の向きの lint |
| 3 | 共通の `components/molecules/` の切り出し（`SearchBox`・`Modal`・`CopyButton`）。`SettingsModal`・`RoleDialog` を `Modal` に揃える |
| 4 | `src/features/` をなくす（部品を `components/features/<機能>/<階層>/`、フックを `hooks/<機能>/`、定数を `constants/<機能>/` へ）。機能専用の molecules（`ToolCallIndicator`・`WebSearchResult`・`ConversationListItem`・`SearchResultItem`）を切り出す。`SettingsModal` を `components/features/settings/organisms/` へ。`ChatLayout` を作り、`page.tsx` を組み立てだけにする |
