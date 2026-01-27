# アーキテクチャ設計書

## システム構成

```
ブラウザ (Next.js Frontend)
    ↓ fetch (streaming)
Next.js Route Handlers (API層)
    ├──→ Prisma ORM ──→ PostgreSQL (Docker)
    └──→ HTTP POST (streaming) ──→ Ollama API (localhost:11434) ──→ qwen3-coder:latest
```

- フロントエンドからOllamaへ直接通信しない。Route Handlersを経由する。
- 会話履歴はPostgreSQLに永続化し、Prisma ORMで操作する。
- Ollama接続先はローカルのみ想定（`localhost:11434`）。

## ディレクトリ構成

> **重要**: `base/` は読み取り専用（編集禁止）。開発コードは全て `front/` 内に配置する。

### プロジェクト全体

```
local-ai-chat-web-app/
├── .github/
│   └── workflows/
│       └── e2e-test.yml       # GitHub Actions E2Eテストワークフロー
├── base/                      # UIデザインリファレンス（読み取り専用・編集禁止）
├── docs/                      # プロジェクトドキュメント
├── manuals/                   # セットアップガイド等のマニュアル
│   └── setup-guide-macos.md   #   macOS向けセットアップ手順書
├── front/                     # Next.jsアプリケーション本体（開発はここで行う）
│   ├── src/                   #   ソースコード
│   ├── prisma/                #   Prismaスキーマ・マイグレーション
│   ├── tests/                 #   テスト
│   ├── public/                #   静的ファイル
│   ├── .env.local             #   環境変数
│   ├── next.config.ts         #   Next.js設定
│   ├── tailwind.config.ts     #   TailwindCSS設定
│   ├── tsconfig.json          #   TypeScript設定
│   ├── playwright.config.ts   #   Playwright設定
│   ├── package.json
│   └── pnpm-lock.yaml
├── docker-compose.yml         # PostgreSQLコンテナ定義
├── CLAUDE.md
└── README.md
```

### front/src/ 内部構成

```
front/src/
├── app/                       # Next.js App Router
│   ├── globals.css            #   グローバルCSS（テーマ変数定義含む）
│   ├── layout.tsx             #   ルートレイアウト
│   ├── page.tsx               #   トップページ（チャット画面・状態管理の中心）
│   └── api/                   #   Route Handlers
│       ├── chat/
│       │   └── route.ts       #     Ollama通信（ストリーミング、model指定可）
│       ├── models/
│       │   └── route.ts       #     利用可能モデル一覧取得
│       └── conversations/
│           ├── route.ts       #     会話一覧取得・新規作成
│           └── [id]/
│               ├── route.ts   #     会話削除
│               ├── generate-title/
│               │   └── route.ts #   LLMで会話タイトル自動生成
│               └── messages/
│                   └── route.ts #   メッセージ取得・保存
├── components/                # 共通UIコンポーネント
│   └── SettingsModal.tsx      #   設定モーダル（モデル選択・テーマ切替）
├── features/                  # 機能固有モジュール
│   ├── chat/
│   │   ├── components/
│   │   │   ├── ChatBar.tsx    #     メッセージ入力（IME対応、forwardRef）
│   │   │   ├── ChatWindow.tsx #     メッセージ一覧表示
│   │   │   ├── Footer.tsx     #     フッター
│   │   │   ├── Header.tsx     #     ヘッダー（モデル選択ドロップダウン）
│   │   │   └── MarkdownContent.tsx # Markdown整形表示
│   │   └── hooks/
│   │       └── useChat.ts     #     チャットロジック（ストリーミング、タイトル生成）
│   └── sidebar/
│       ├── components/
│       │   └── Sidebar.tsx    #     サイドバー（会話一覧、設定ボタン）
│       └── hooks/
│           └── useConversations.ts # 会話CRUD管理
├── generated/
│   └── prisma/                #   Prisma自動生成クライアント（出力先カスタマイズ）
├── hooks/
│   └── useTheme.ts            #   テーマ切替フック（localStorage永続化）
├── lib/
│   ├── ollama.ts              #   Ollamaクライアント（streamChat, listModels）
│   ├── prisma.ts              #   Prismaクライアントインスタンス
│   └── validation.ts          #   バリデーションユーティリティ
└── types/
    └── index.ts               #   共通型定義（Message, Conversation等）
```

### front/prisma/

```
front/prisma/
├── schema.prisma              # スキーマ定義
└── migrations/                # マイグレーション履歴
```

### front/tests/

```
front/tests/
└── e2e/
    ├── helpers/
    │   └── test-data.ts           # テストデータ管理ヘルパー（CRUD・入力支援）
    ├── chat.spec.ts               # チャット機能テスト
    ├── chat-streaming.spec.ts     # ストリーミング表示テスト
    ├── sidebar.spec.ts            # サイドバー操作テスト
    ├── conversation.spec.ts       # 会話管理テスト
    ├── security.spec.ts           # セキュリティテスト
    ├── responsive.spec.ts         # レスポンシブテスト
    ├── screenshot.spec.ts         # スクリーンショットテスト（CIスキップ）
    ├── debug-console.spec.ts      # デバッグ用テスト（CIスキップ）
    ├── debug-input.spec.ts        # 入力方式デバッグ用テスト（CIスキップ）
    └── screenshot.spec.ts-snapshots/ # ベースラインスナップショット（OS別）
```

### ディレクトリ方針

- **`components/`**: 複数機能で再利用される汎用UIコンポーネントを配置
- **`features/`**: 機能固有のコンポーネント・フック・型を機能単位でまとめる
- **`hooks/`**: 複数機能で共有されるカスタムフックを配置
- **`lib/`**: 外部サービス連携やユーティリティ関数を配置
- **`types/`**: 複数機能で共有される型定義を配置
- 機能固有のコンポーネント・フック・型は `features/<機能名>/` 内に閉じる

## データベース設計

### ERD

```
Conversation           Message
┌──────────────┐       ┌──────────────────┐
│ id (UUID PK) │──┐    │ id (UUID PK)     │
│ title        │  │    │ conversationId   │──→ Conversation.id (FK)
│ createdAt    │  │    │ role             │    ('user' | 'assistant')
│ updatedAt    │  └───<│ content          │
└──────────────┘       │ createdAt        │
                       └──────────────────┘
```

### Prismaスキーマ

```prisma
model Conversation {
  id        String    @id @default(uuid())
  title     String
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  messages  Message[]
}

model Message {
  id             String       @id @default(uuid())
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  role           String       // 'user' | 'assistant'
  content        String
  createdAt      DateTime     @default(now())
}
```

## データフロー

### チャット送信フロー

1. ユーザーが`ChatBar`でメッセージ入力・送信（IME composition対応）
2. 親コンポーネント（`page.tsx`）がユーザーメッセージをstateに追加
3. 新規会話の場合、`/api/conversations` で会話作成（`skipLoadRef` で競合回避）
4. `/api/conversations/[id]/messages` にユーザーメッセージをDB保存
5. `/api/chat` Route HandlerにPOSTリクエスト送信（会話履歴 + model指定付き）
6. Route HandlerがOllama APIにストリーミングリクエスト送信
7. Ollamaからのストリーミングレスポンスをクライアントに中継
8. フロントエンドがReadableStreamを読み取り、リアルタイムにUIを更新
9. ストリーミング完了後、AIメッセージをDBに保存
10. 新規会話の場合、`/api/conversations/[id]/generate-title` でタイトル自動生成

### 会話管理フロー

1. ページ読み込み時に `/api/conversations` から会話一覧を取得
2. サイドバーに一覧表示
3. 会話選択時に `/api/conversations/[id]/messages` からメッセージを取得
4. 新規会話作成時に `/api/conversations` にPOST
5. New Conversationボタンで新規会話モードに切替（`currentConversationId = null`）

### ストリーミング実装方針

- **API側**: Ollama `/api/chat` エンドポイントの `stream: true` オプションを使用
- **Route Handler**: `ReadableStream` を返す `Response` オブジェクトを生成
- **フロントエンド**: `fetch` + `ReadableStream` で逐次読み取り

## 環境変数

| 変数名 | 説明 | デフォルト値 |
|--------|------|-------------|
| `OLLAMA_BASE_URL` | Ollama APIの接続先 | `http://localhost:11434` |
| `OLLAMA_MODEL` | 使用するモデル名 | `qwen3-coder:latest` |
| `DATABASE_URL` | PostgreSQL接続文字列 | `postgresql://postgres:postgres@localhost:5432/chat_db` |

## 状態管理

- React `useState` によるローカルstate管理
- グローバルstate管理ライブラリは使用しない
- 会話履歴はPostgreSQLに永続化し、API経由で取得・保存
- テーマ選択はlocalStorageに永続化（`useTheme`フック）

## テーマシステム

CSS変数ベースのテーマ切替を実装。

- **方式**: `<html>` 要素の `data-theme` 属性で切替
- **CSS**: `globals.css` の `@theme` ディレクティブでCSS変数を定義。`[data-theme='aurora']`, `[data-theme='ocean']` セレクタで変数を上書き
- **状態管理**: `useTheme` フックで `useState` + `useEffect` で管理
- **永続化**: localStorageにテーマIDを保存

### テーマ一覧

| テーマID | 名前 | 説明 |
|---------|------|------|
| `nordic` | Nordic Frost | 北欧ブルーのデフォルトテーマ（`data-theme`属性なし） |
| `aurora` | Aurora Borealis | 紫とシアンのオーロラテーマ |
| `ocean` | Midnight Ocean | 深海ブルーのダークテーマ |

### 注意事項

- TailwindCSS 4の `@theme` ディレクティブは `@theme inline` ではなく `@theme` を使用すること。`@theme inline` はCSS変数参照（`var(--color-nord-0)`）ではなく値を直接インラインするため、テーマ切替が機能しない。
- React Compiler環境では、レンダリング中の副作用（DOM操作）が最適化で除去される可能性があるため、DOM操作は必ず `useEffect` 内で行うこと。
