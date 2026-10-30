---
description: Prisma ORM 命名規約・マイグレーション・クエリ規約
globs: "front/prisma/**,front/src/lib/server/prisma.ts,front/src/generated/**"
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
  id           String    @id @default(uuid())
  title        String
  systemPrompt String? // 会話の役割（システムプロンプト）。null は役割なし
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  messages     Message[]
}

model Message {
  id             String       @id @default(uuid())
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  role           String       // 'user' | 'assistant'
  content        String
  metadata       Json?        // ツール呼び出し情報・思考過程等（nullable）
  createdAt      DateTime     @default(now())
  attachments    Attachment[]
}

// メッセージの画像。user は添付した画像（#6）、assistant はブラウザのツールが撮った画面（#200）
model Attachment {
  id        String   @id @default(uuid())
  messageId String
  message   Message  @relation(fields: [messageId], references: [id], onDelete: Cascade)
  position  Int      // メッセージ内の並び順（0 始まり）
  mimeType  String   // 中身（マジックナンバー）から判定した形式（image/png・image/jpeg）
  width     Int
  height    Int
  size      Int      // バイト数
  data      Bytes    // 画像の中身（bytea）
  createdAt DateTime @default(now())

  @@index([messageId])
}
```

- 添付画像は DB（`bytea`）に置く（ファイルに置かない）。assistant の画像（ブラウザのツールの画面。#200）は `metadata.toolCalls[].screenshots` の ID で参照し、添付画像としては表示しない。会話の削除で Conversation → Message → Attachment とカスケード削除され、取り残しが出ないため。メッセージ一覧の取得では `data` を select しない（`docs/13-image-attachment.md`）。

## Prisma クライアント

- クライアント出力先: `src/generated/prisma/`（標準の `node_modules` ではない）
- インポート: `import { PrismaClient } from '@/generated/prisma/client'`
- スキーマ変更後は `pnpm prisma generate` でクライアント再生成する

## マイグレーション

- `pnpm prisma migrate dev` で開発環境のマイグレーションを管理する。
- マイグレーションファイルは手動で編集しない。
- DB 接続先: `postgresql://postgres:postgres@localhost:5499/chat_db`（ポート: 5499）

## クエリ

- Prisma Client のパラメータバインディングを使用する。`$queryRaw` での文字列結合は禁止。
- Conversation 削除時はメッセージ・添付画像も `onDelete: Cascade` でカスケード削除される。
