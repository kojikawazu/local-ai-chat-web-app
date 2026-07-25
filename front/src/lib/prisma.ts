import { PrismaClient } from '@/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// `globalThis` の型に `prisma` は存在しないため二段キャストで隙間を埋める。
// なぜ安全か: 参照するのは自前で追加する `prisma` プロパティ 1 つだけで、既存の
// グローバル型を書き換えていない（未定義なら `undefined` が返るだけ）。
// なぜ必要か: `declare global` で型拡張すると本ファイル外にもプロパティが見えて
// しまい、シングルトンの取得経路を `prisma` export に限定できなくなる。
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  });
  return new PrismaClient({ adapter });
}

/**
 * アプリ全体で共有する Prisma クライアントのシングルトン。
 * 開発時のホットリロードで接続が増殖しないよう `globalThis` にキャッシュして再利用する。
 */
export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
