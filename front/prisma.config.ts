import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Prisma 7 の CLI は環境変数のファイルを自分では読まないため、ここで読む（#229）。
// アプリ（Next.js）と同じく `.env.local` を先にし、無い値だけを `.env` から足す。
// すでに環境変数にある値（CI・IT の Testcontainers が渡す DATABASE_URL）は上書きしない。
// 置き場所はこのファイルの隣（`front/`）。実行したフォルダに左右されないため
config({
  path: ['.env.local', '.env'].map((name) =>
    fileURLToPath(new URL(name, import.meta.url))
  ),
  quiet: true,
});

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
