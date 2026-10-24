---
description: TypeScript コーディング規約 — type/interface の使い分け・型定義の配置等、TS 固有の指針
globs: front/src/**
---

# TypeScript コーディング規約

共通の `coding-standards.md` に加え、TypeScript 固有の指針を定める。命名規則は Linter 既定に委ね、本書では扱わない。

## type vs interface

**原則 `type` を使う。** 以下の 2 条件のいずれかに当たる場合のみ `interface` を使う。

- **条件 1: class 契約** — その型を **class が `implements` / `extends` する**
  - サービス契約・リポジトリポート・DI 抽象など
  - → 本プロジェクトは関数 + カスタムフック中心で class を使わないため、**ほぼ該当しない**
- **条件 2: 宣言マージが必要** — 型を**後から拡張する**必要がある
  - グローバル型の拡張（`declare global { interface Window { ... } }`）
  - ライブラリ型の拡張
  - → `type` は宣言マージできないため、ここは `interface` でしか実現できない
- **`type` を使う**（上記以外すべて）
  - class が絡まないオブジェクト形状（props・API リクエスト/レスポンス型・ツール定義）
  - union / 交差 / tuple / 関数型 / mapped・conditional 型などの型演算

宣言マージは「意図せず型が拡張され得る」副作用でもある。**アプリ内部の型に `interface` を選ぶ理由にはしない**（条件 1 か、外部から拡張される前提の型に限る）。

```ts
// 条件 2: 宣言マージ → interface
declare global {
  interface Window {
    __chatDebug?: boolean;
  }
}

// それ以外 → type（props・union・関数型）
type MessageRole = 'user' | 'assistant';
type ChatMessage = { id: string; role: MessageRole; content: string };
type OnSend = (content: string) => void;
```

### 既存コードへの適用

**既存の `interface` は 15 ファイル・約 24 箇所に分布している**（`types/` のドメイン型、各コンポーネントの props 型、`lib/agent/tools/types.ts` のツール定義型など）。いずれも class 契約・宣言マージには該当せず、本来 `type` で書くべきものだが、**一括置換はしない**（差分が大きく、レビューの費用対効果が悪い）。

- **新規に追加する型は `type`** で書く。
- 既存 `interface` は、**その型を触る変更のついでに** `type` へ寄せる。
- **変換だけを目的とした PR は作らない。** 機械的な置換は `git blame` を汚すだけで、動作もレビュー価値も変わらない。
- したがって `interface` の残存は**規約違反として扱わない**（新規追加のみ違反）。レビューでは「新しく足された型が `type` か」を見る。

## 型定義の配置（コロケーション / `types/` 集約）

型を各ファイルに散在させず、**参照範囲**で置き場所を決める。判断軸は「**その型を参照するファイルが 1 つに閉じるか**」。

| 参照範囲 | 置き場所 |
|---|---|
| **1 ファイルに閉じる** | その定義ファイル内にコロケーション（`export` しない） |
| **2 ファイル以上** / レイヤ・機能をまたぐ | `src/types/<機能>/<ドメイン>.ts` に集約して `export` |

機能内（`features/chat/` 等）で複数ファイルが参照するが機能外からは参照されない型は、その機能ディレクトリ内に置いてよい。`src/types/` は**機能をまたぐ共通型**の置き場とする。

### 運用ルール

- **最初から `types/` に置かない。** まず定義ファイル内に書き、**2 箇所目の参照が発生した時点で `types/` へ昇格**させる。先回りの集約は、使われない共通型と不要な依存を増やす。
- **昇格時は元ファイルに型を残さない**（re-export も含む）。定義は常に 1 箇所。
- `types/` は機能ごとのディレクトリに分け、その中をドメイン単位のファイルにする（`types/chat/message.ts`・`types/conversation/conversation.ts`・`types/agent/tool-call.ts`。#160）。1 ファイルに全ドメインを詰めない。
- **barrel（他ファイルを一括 re-export するだけの `index.ts`）は作らない。** 循環参照・バンドル肥大・tree-shaking 阻害の原因になる。`import type { Message } from '@/types/chat/message'` と**実ファイルを直接 import** する（`@/types` だけの import は無い）。
- Prisma の生成型（`@/generated/prisma/client`）を `types/` に再定義しない。DB の形と API/UI の形が違う場合のみ、変換先の型を `types/` に定義する。

### 分類の目安

- **`types/` に置く**: API レスポンス/リクエスト型、ドメインエンティティ、複数画面で共有する union リテラル、ストリーミングイベント型、共通のユーティリティ型
- **コロケーションのまま**: コンポーネントの props 型（コンポーネントと 1:1 で、UI の変更と同時に変わる）、そのファイル内でしか使わない内部型・引数オブジェクト型

```ts
// コンポーネント固有 → コロケーション（export しない）
type ChatBarProps = { onSend: (content: string) => void; disabled: boolean };
export function ChatBar({ onSend, disabled }: ChatBarProps) { /* ... */ }

// 複数箇所から参照 → types/chat/message.ts に集約
// types/chat/message.ts
export type MessageRole = 'user' | 'assistant';
export type ChatMessage = { id: string; role: MessageRole; content: string };
```

### 型へのコメント

`type` / `interface` は**型本体・各メンバーともにコメント必須**。詳細は `jsdoc.md`（必須対象・記述ルール）に従う。

## 定数の配置（`constants/` 集約）

**マジックナンバー・マジック文字列を直接書かない。** 分岐条件・API パス・ストレージキー・上限値・リトライ回数などのリテラルは名前付き定数にする。名前が付いていない値は、検索もできず変更漏れも検出できない。

置き場所は型と**同じ「参照範囲」の軸**で決める。

| 参照範囲 | 置き場所 |
|---|---|
| **1 ファイルに閉じる** | その定義ファイルの先頭で `const` 宣言（`export` しない） |
| **2 ファイル以上**（機能内・機能をまたぐ） | `src/constants/<機能>/` に集約して `export`（例: `constants/chat/toolLabels.ts`） |

`src/features/` をなくす移行（#163 の段階 4）が済むまでは、機能内の定数が `features/<機能>/constants/`（`features/chat/constants/toolLabels.ts`）に残る。新しく足す定数は `src/constants/<機能>/` に置く（#160 の `src/<層>/<機能>/` の規則）。

なお入力上限値（`MAX_MESSAGE_LENGTH` / `MAX_ASSISTANT_MESSAGE_LENGTH` / `MAX_TITLE_LENGTH`）は例外的に `lib/shared/validation.ts` に置いている。検証関数（`isValidUUID`）と同じ関心事であり、フロント・API 双方から参照される単一の正準として機能しているため（`error-handling.md` 参照）。

### 運用ルール

- **`lib/` に定数を混ぜない。** 「関数の置き場」と「値の置き場」を分けると、変更時に探す範囲が狭まる（上記 `validation.ts` は検証の関心事に属する例外）。
- 昇格の運用は型と同じ: まず使う場所に書き、**2 箇所目の参照が発生した時点で `constants/` へ移す**。移動時は元ファイルに残さない（re-export も含む）。
- `constants/` は機能ごとのディレクトリに分け、その中をドメイン単位のファイルにする（`constants/chat/toolLabels.ts`）。**barrel（`index.ts`）は作らない**（理由は型と同じ）。
- **`as const` を付ける。** 付けないとリテラル型が `string` / `number` に広がり、union の導出や補完が効かなくなる。
- 命名は `UPPER_SNAKE_CASE`。オブジェクト定数のキーも同様に揃える。

### 型の元になる定数は「型と同じファイル」に置く

union リテラルの元になる配列・オブジェクトは、**導出される型とセットで `types/` 側に置く**。`constants/` と `types/` に分けると、値と型が常に往復参照になり、片方だけ更新される事故が起きる。

```ts
// types/theme/theme.ts — 値と型はペアで同居させる
/** 選択可能なテーマ。切替 UI の表示順もこの配列の順序に従う。 */
export const THEMES = ['nordic', 'aurora', 'ocean'] as const;
/** 選択可能なテーマ識別子。`data-theme` 属性値と一致させる */
export type Theme = (typeof THEMES)[number];

// constants/chat.ts — 型を導出しない純粋な値はこちら
/** メッセージ入力の最大文字数。API 側のバリデーション上限と一致させる */
export const MESSAGE_MAX_LENGTH = 10_000;
```

### 環境変数は定数ではない

環境ごとに値が変わるもの（`OLLAMA_BASE_URL`・`OLLAMA_MODEL`・`DATABASE_URL` 等）を `constants/` に置かない。ビルド時に特定環境の値が埋め込まれ、環境差異の事故につながる。環境変数は読み込み層（`lib/llm/ollama.ts` 等）でフォールバック付きに解決する。`constants/` に置くのは**全環境で不変な値**だけ。

### 定数へのコメント

`export` された定数は**コメント必須**（`jsdoc.md`）。特に**単位**（`AGENT_TOOL_TIMEOUT_MS` がミリ秒であること）と**その値である根拠**（「API 側の上限が 10,000 のため」）を書く。根拠のない数値は、後から誰も変更してよいか判断できない。

## any 禁止・unknown 優先

- **暗黙・明示を問わず `any` を禁止**する（`strict: true` / `noImplicitAny` 前提）。
- 外部入力（Ollama のレスポンス・`JSON.parse`・ユーザー入力・Web 取得結果）は **`unknown` で受け**、型ガード・バリデーション（`lib/shared/validation.ts`）で**ナローイング**してから使う。
- どうしても `any` が必要な箇所は根拠コメントを残す（「as/! 抑制」節参照）。

## enum 回避・union リテラル + as const

- `enum` より **union リテラル型**＋必要なら **`as const`** を優先する。
- 理由: `enum` はランタイムにオブジェクトを生成しバンドルに残る／tree-shaking されにくい／`const enum` は分離コンパイルで問題が出る。union リテラルは型のみで**ランタイムコストゼロ**。

```ts
// 非推奨
enum Role { User, Assistant }
// 推奨
const MESSAGE_ROLES = ['user', 'assistant'] as const;
type MessageRole = (typeof MESSAGE_ROLES)[number];
```

## import type 強制

- 型だけを import する場合は **`import type`** を使う（値と型を混ぜない）。
- 理由: バンドラ／トランスパイラが型を確実に消せる、副作用のない循環参照を避けられる。
- **機械強制済み**: `@typescript-eslint/consistent-type-imports`（`fixStyle: separate-type-imports`）を `eslint.config.mjs` に導入。`pnpm lint` で検出、`--fix` で自動修正できる。
- **`verbatimModuleSyntax: true`** を `tsconfig.json` で有効化済み（型 import が実行時に残らないことを型レベルでも保証する）。
- 値と型が同じモジュールから必要な場合は、**inline（`import { type X, y }`）ではなく 2 文に分離**する。

```ts
// 値と型が混在する場合は分離する
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
```

```ts
import type { ChatMessage } from '@/types/chat';
import { streamChat } from '@/lib/ollama';
```

## as / ! 抑制

- 型アサーション `as` と non-null assertion `!` を**最小化**する。まず型ガード・早期 return・オプショナルチェーンで解決する。
- 使う場合は**根拠コメント必須**（なぜ安全か／なぜ必要か）。`as unknown as` / `as any` / `@ts-ignore` / `@ts-expect-error` の根拠記述は `jsdoc.md`（混乱テスト）と接続する。
- `as const`（リテラル固定）はここでの「アサーション」に含まない（推奨用途）。
