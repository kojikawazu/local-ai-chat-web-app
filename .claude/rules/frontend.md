---
description: Next.js (App Router) フロントエンド設計・コンポーネント規約
globs: "front/src/components/**,front/src/app/[^a]*/**,front/src/hooks/**,front/src/features/**"
---

# フロントエンドルール（Next.js App Router）

## コンポーネント設計（Atomic Design）

UI コンポーネントは **Atomic Design**（atoms / molecules / organisms / templates / pages）で整理する（#163）。設計の詳細（判断基準・各部品の props・移行の段階）は `docs/12-ui-components.md` が正準。

- **置き場所**: 層 → 機能 → 階層の順に分ける。
  - 共通の部品（ドメインを知らない）: `src/components/common/{atoms,molecules,templates}/`
  - 機能の部品: `src/components/features/<機能>/{atoms,molecules,organisms}/`
  - page: `src/app/page.tsx`（フックを呼び、organisms を組み立てて template へ渡すだけ）
- **判断の目安**: 別のアプリにそのまま持っていけるなら共通、このアプリの会話・メッセージ・ツールを知っているなら機能の部品。機能の部品が 2 つ目の機能から必要になったら、ドメインの知識を外して共通の階層へ移す。
- **依存の向き**: 下の階層は上を import しない。共通の部品は `components/features/**` とドメインのフックを import しない。機能の部品は他の機能の部品を import しない。organisms は templates を import しない。ESLint（`no-restricted-imports`。`eslint.config.mjs` の `atomicDesignRules`）で強制する。機能を足したら、同ファイルの `UI_FEATURES` に機能名を足す。
- **atoms の作り方**: 素の要素の props を受け、見た目は `variant`・`size` の union で選ぶ。色はテーマの CSS 変数だけを使い、外からの `className` は配置に限る。`forwardRef` は使わない（React 19 は `ref` を props で受け取れる）。アイコンだけのボタンは `label` を必須にする。
- **モーダル**はネイティブの `<dialog>` + `showModal()` の共通 `Modal` に揃える（サイドバーのドロワーは対象外）。
- 空の階層のディレクトリは作らない。re-export だけの `index.ts`（barrel）は作らない。

**移行中（#163）**: 段階 2〜4 が済むまでは、下表の今の構成（`src/features/<機能>/components/` 等）が残る。新しく部品を足すときは、上の置き場所に従う。

今の構成（移行前）:

| ディレクトリ | 役割 |
|---|---|
| `features/` | 機能固有モジュール（各機能に components/, hooks/ を内包） |
| `components/` | 複数機能で再利用する共通 UI コンポーネント（例: `components/settings/SettingsModal.tsx`） |
| `hooks/` | 共通カスタムフック（例: `hooks/theme/useTheme.ts`） |
| `lib/` | ユーティリティ・外部連携（`agent/`・`llm/`・`chat/`・`conversation/`・`server/`・`shared/`） |
| `types/` | 機能をまたぐ共通型（`agent/`・`chat/`・`conversation/`・`theme/`） |

**`hooks/`・`lib/`・`types/`・`constants/` の中は、機能ごとのディレクトリに分ける**（`src/<層>/<機能>/<ファイル>`。#160）。直下にファイルを置かない。新しいファイルは、使う機能のディレクトリに置き、無ければ作る。`components/` だけは上の Atomic Design の構成（`common/<階層>/` と `features/<機能>/<階層>/`）に従う。

- `lib/server/` はサーバー専用（Prisma・Route Handler の入力検証）。クライアントから import しない。
- `lib/shared/` はサーバーとクライアントの両方から使うもの（入力の上限値など）。`next/server`・Prisma に依存させない。
- 機能のディレクトリ名は、なるべく `features/` の機能名（`chat` 等）と揃える。

## サーバー/クライアント分離

**本アプリのルートページ（`app/page.tsx`）は `'use client'` のクライアントコンポーネント。** チャット画面全体がインタラクティブ（ストリーミング表示・入力・会話切替・テーマ）で、サーバーで確定できる描画がほぼ無いため、サーバーコンポーネント化する利点がない。

- 新規に**サーバーで完結する画面**（静的ページ・初期データを埋め込む一覧など）を追加する場合は、サーバーコンポーネントを既定とする。
- ルートページにサーバー側データ取得が必要になった場合は、**サーバーの `page.tsx` + クライアントのコンテナコンポーネント**に分割する（`page.tsx` を丸ごとクライアントにしたまま `fetch` を足さない）。
- データ取得は Route Handler 経由（`fetch('/api/...')`）で行う。**フロントから Prisma / Ollama を直接叩かない**。
- `'use client'` を明示したコンポーネント — インタラクション・状態管理を担う。

## ロジック分離

- クライアントコンポーネントの**ドメインロジックはカスタムフックに切り出す**。コンポーネントは UI 描画と繋ぎに専念する。
  - フックは `hooks/<機能>/` に置く（例: `hooks/theme/useTheme.ts`。移行後は `hooks/chat/useChat.ts`・`hooks/sidebar/useConversations.ts`）。移行中（#163 の段階 4 まで）は機能固有のフックが `features/<機能>/hooks/` に残る
- **`page.tsx` に残してよいのは「画面全体の合成」に属するものだけ**: 各フックの呼び出し、フック間を繋ぐコールバック、画面レベルの UI state（モーダルの開閉など）。
- 逆に `page.tsx` へ置かないもの: API 通信、ストリーミング処理、永続化ロジック、ドメインルール。これらはフックへ寄せる。
- **判断の目安**: `page.tsx` 内の `useState` / `useEffect` が特定の関心事（例: 設定値の localStorage 永続化）でまとまってきたら、その単位でフックに抽出する。

## React Compiler

- React 19 + React Compiler 有効（`next.config.ts` で `reactCompiler: true`）。
- レンダリング中の副作用が最適化で除去されるため、DOM 操作は必ず `useEffect` 内で行う。

## テーマシステム

- CSS 変数ベースの3テーマ切替（Nordic Frost / Aurora Borealis / Midnight Ocean）。
- `globals.css` の `@theme` ディレクティブで CSS 変数を定義（`@theme inline` は使用禁止）。
- `[data-theme='aurora']`, `[data-theme='ocean']` セレクタで変数を上書き。
- **テーマ定義の正準は `src/types/theme/theme.ts`**（`THEMES` を `as const` で定義し、`ThemeId` をそこから導出する）。テーマを追加する場合は `THEMES` への追記と `globals.css` のセレクタ追加を**必ず対で行う**。セレクタではシンタックスハイライト専用の `--color-nord-aurora-orange` / `--color-nord-aurora-purple` も定義する（無いと数値・メタの色が Nord のまま残る）。
- 既定テーマ（`nordic`）は `data-theme` 属性を**付けない**ことで表現する。`useTheme` の `DEFAULT_THEME_ID` がこの分岐を持つ。

## インポート

- `@/*` パスエイリアスを使用する（`tsconfig.json` で `@/*` → `./src/*`）。
- Prisma クライアントは `@/generated/prisma/client` からインポートする（標準の `node_modules` ではない）。

## 状態管理

- `useState` のみ使用。グローバル state 管理ライブラリ（Redux, Zustand 等）は使用しない。

## テスト

- E2E: Playwright（`front/tests/e2e/` ディレクトリ）
- Base URL: `http://localhost:3000`
