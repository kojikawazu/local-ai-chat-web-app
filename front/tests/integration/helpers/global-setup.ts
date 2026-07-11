import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';

/**
 * IT 用のエフェメラル PostgreSQL を Testcontainers で起動し、Prisma マイグレーションを適用する。
 *
 * 開発 DB には一切触れず、テスト実行のたびに使い捨てコンテナを立てて完全隔離する。
 * 払い出した接続 URL を `provide('DATABASE_URL')` で各テストへ渡し、終了時に破棄する。
 *
 * @param ctx - Vitest のグローバルセットアップコンテキスト（`provide` で値を注入する）
 * @returns テスト終了後に呼ばれるティアダウン関数（コンテナを停止する）
 */
export default async function setup({
  provide,
}: {
  provide: (key: 'DATABASE_URL', value: string) => void;
}) {
  const container = await new PostgreSqlContainer('postgres:16').start();
  const url = container.getConnectionUri();

  // 使い捨て DB にスキーマを適用する。Prisma CLI は datasource に url が無くても
  // 環境変数 DATABASE_URL を参照する（CI の e2e ジョブと同方式）。
  execSync('pnpm prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });

  provide('DATABASE_URL', url);

  return async () => {
    await container.stop();
  };
}

declare module 'vitest' {
  interface ProvidedContext {
    DATABASE_URL: string;
  }
}
