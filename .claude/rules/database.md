---
description: Prisma ORM 命名規約・マイグレーション・クエリ規約
globs: "front/prisma/**,front/src/lib/prisma.ts,front/src/generated/**"
---

# データベースルール（Prisma）

## 命名規約

- モデル名: PascalCase・単数形（例: `Conversation`, `Message`）
- フィールド名: camelCase（例: `conversationId`, `createdAt`）

## 共通フィールド

| フィールド | 型 | 説明 |
|-----------|------|------|
| id | String @id @default(uuid()) | 主キー（UUID） |
| createdAt | DateTime @default(now()) | 作成日時 |
| updatedAt | DateTime @updatedAt | 更新日時 |

## スキーマ

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
  metadata       Json?        // ツール呼び出し情報・思考過程等（nullable）
  createdAt      DateTime     @default(now())
}
```

## Prisma クライアント

- クライアント出力先: `src/generated/prisma/`（標準の `node_modules` ではない）
- インポート: `import { PrismaClient } from '@/generated/prisma'`
- スキーマ変更後は `pnpm prisma generate` でクライアント再生成する

## マイグレーション

- `pnpm prisma migrate dev` で開発環境のマイグレーションを管理する。
- マイグレーションファイルは手動で編集しない。
- DB 接続先: `postgresql://postgres:postgres@localhost:5499/chat_db`（ポート: 5499）

## クエリ

- Prisma Client のパラメータバインディングを使用する。`$queryRaw` での文字列結合は禁止。
- Conversation 削除時はメッセージも `onDelete: Cascade` でカスケード削除される。
