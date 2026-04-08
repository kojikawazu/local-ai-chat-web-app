---
description: Next.js (App Router) フロントエンド設計・コンポーネント規約
globs: "front/src/components/**,front/src/app/[^a]*/**,front/src/hooks/**,front/src/features/**"
---

# フロントエンドルール（Next.js App Router）

## コンポーネント設計

このプロジェクトは**ドメイン別構成（ハイブリッド方式）**を採用している:

| ディレクトリ | 役割 |
|---|---|
| `features/` | 機能固有モジュール（各機能に components/, hooks/ を内包） |
| `components/` | 複数機能で再利用する共通 UI コンポーネント |
| `hooks/` | 共通カスタムフック |
| `lib/` | ユーティリティ・外部連携（ollama, prisma, validation, agent 等） |

## サーバー/クライアント分離

- **server-first** を基本とする。
- `page.tsx` — サーバーコンポーネント（データ取得・props 受け渡し）
- `'use client'` を明示したコンポーネント — インタラクション・状態管理

## ロジック分離

- クライアントコンポーネントのロジックはカスタムフック（`hooks/`）に切り出す。コンポーネントは UI 描画に専念する。

## React Compiler

- React 19 + React Compiler 有効（`next.config.ts` で `reactCompiler: true`）。
- レンダリング中の副作用が最適化で除去されるため、DOM 操作は必ず `useEffect` 内で行う。

## テーマシステム

- CSS 変数ベースの3テーマ切替（Nordic Frost / Aurora Borealis / Midnight Ocean）。
- `globals.css` の `@theme` ディレクティブで CSS 変数を定義（`@theme inline` は使用禁止）。
- `[data-theme='aurora']`, `[data-theme='ocean']` セレクタで変数を上書き。

## インポート

- `@/*` パスエイリアスを使用する（`tsconfig.json` で `@/*` → `./src/*`）。
- Prisma クライアントは `@/generated/prisma/client` からインポートする（標準の `node_modules` ではない）。

## 状態管理

- `useState` のみ使用。グローバル state 管理ライブラリ（Redux, Zustand 等）は使用しない。

## テスト

- E2E: Playwright（`front/tests/e2e/` ディレクトリ）
- Base URL: `http://localhost:3000`
