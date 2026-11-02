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
  // 分岐した応答（#29）。分岐していない・分岐元が消えた会話は null
  forkedFromMessageId String?
  forkedFromMessage   Message? @relation("ConversationFork", fields: [forkedFromMessageId], references: [id], onDelete: SetNull)

  @@index([forkedFromMessageId])
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
  bookmark       Bookmark?
  forkedConversations Conversation[] @relation("ConversationFork") // この応答から分岐した会話（#29）
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

// 入力欄の `/` で呼び出すプロンプトのテンプレート（#28）。会話とはリレーションを持たない
model PromptTemplate {
  id        String   @id @default(uuid())
  name      String   // 表示名（候補・管理画面）
  shortcut  String   @unique // `/` の後ろに打つ名前（先頭の `/` は含めない。小文字で保存する）
  content   String   // 入力欄に入れる本文（前後の空白・改行も書いたまま）
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

// 応答（assistant のメッセージ）のブックマーク（#30）。1 つの応答に 1 つまで
model Bookmark {
  id        String   @id @default(uuid())
  messageId String   @unique
  message   Message  @relation(fields: [messageId], references: [id], onDelete: Cascade)
  note      String?  // メモ。null はメモなし（空白だけのメモも null にする）
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

// RAG で参照する、取り込んだドキュメント（#17）。会話とはリレーションを持たない
model KnowledgeDocument {
  id             String           @id @default(uuid())
  name           String           @unique // ファイル名（同じ名前で取り込むと置き換える）
  content        String // 取り込んだ本文（BOM を外し改行をそろえた後）。作り直しに使う
  size           Int // 本文のバイト数（UTF-8）
  embeddingModel String // チャンクの埋め込みを作ったモデル。今のモデルと違えば検索に使わない
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt
  chunks         KnowledgeChunk[]
}

// ドキュメントを分けた 1 つと、その埋め込み（#17）。id はアプリで作り $executeRaw で入れる
model KnowledgeChunk {
  id         String                @id
  documentId String
  document   KnowledgeDocument     @relation(fields: [documentId], references: [id], onDelete: Cascade)
  position   Int // ドキュメントの中の並び順（0 始まり）
  heading    String // 見出しの経路（「範囲 > 含める」）。見出しの前なら空
  content    String // 本文
  embedding  Unsupported("vector") // 埋め込み（次元は決めない。索引も作らず全件と比べる）

  @@index([documentId])
}
```

- 添付画像は DB（`bytea`）に置く（ファイルに置かない）。assistant の画像（ブラウザのツールの画面。#200）は `metadata.toolCalls[].screenshots` の ID で参照し、添付画像としては表示しない。会話の削除で Conversation → Message → Attachment とカスケード削除され、取り残しが出ないため。メッセージ一覧の取得では `data` を select しない（`docs/13-image-attachment.md`）。
- 一意制約の重複（メッセージのクライアント採番の `id`・プロンプトテンプレートのショートカット・応答のブックマーク）は、事前の確認ではなく制約の違反（`P2002`）で判定して 409 を返す（`lib/server/prisma-error.ts`）。確認と作成の間に同じ値で作られても食い違わないため。
- ブックマーク（#30）は user のメッセージに付けさせない（`role` は文字列の列で DB の制約にしにくいため、API で検証する）。会話の削除で Conversation → Message → Bookmark とカスケード削除され、再生成の置き換え（`PUT .../messages/[messageId]`）は同じトランザクションでその応答のブックマークを消す。
- 分岐した会話（#29）は、分岐元の応答への外部キー（`forkedFromMessageId`）を `onDelete: SetNull` で持つ。分岐元の会話を消すと Conversation → Message のカスケードで応答が消え、分岐した会話の参照だけが `null` になる（分岐した会話は残る）。コピーしたメッセージ・添付画像は分岐した会話のもので、元とは共有しない（添付画像は新しい ID でコピーし、metadata の中のツールの画面の ID も書き換える）。

## Prisma クライアント

- クライアント出力先: `src/generated/prisma/`（標準の `node_modules` ではない）
- インポート: `import { PrismaClient } from '@/generated/prisma/client'`
- スキーマ変更後は `pnpm prisma generate` でクライアント再生成する

## マイグレーション

- `pnpm prisma migrate dev` で開発環境のマイグレーションを管理する。
- マイグレーションファイルは手動で編集しない。**例外**: Prisma が作らない PostgreSQL の拡張（pgvector の `CREATE EXTENSION IF NOT EXISTS vector`。#17）は、Prisma の公式の手順どおり `pnpm prisma migrate dev --create-only` で作ったマイグレーションの先頭に手で足してから適用する。適用済みのマイグレーションは編集しない。
- **pgvector（#17）**: `vector` の列は `Unsupported("vector")` で宣言し、Prisma の `create` では書けないため `$executeRaw`・`$queryRaw`（タグ付きテンプレート・`Prisma.sql` / `Prisma.join`）で読み書きする（`lib/server/knowledge.ts`）。埋め込みは `'[0.1,…]'` の文字列をパラメータで渡して `::vector` にする。Prisma Studio は `KnowledgeChunk` を開けない。DB のイメージは `pgvector/pgvector:0.8.6-pg16-trixie`（`docker-compose.yml`・CI・Testcontainers で同じ版）。
- DB 接続先: `postgresql://postgres:postgres@localhost:5499/chat_db`（ポート: 5499）

## クエリ

- Prisma Client のパラメータバインディングを使用する。`$queryRaw` での文字列結合は禁止。
- Conversation 削除時はメッセージ・添付画像・ブックマークも `onDelete: Cascade` でカスケード削除される。KnowledgeDocument の削除ではチャンク（KnowledgeChunk）がカスケード削除される。
