import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * インテグレーションテスト（IT）用の Vitest 設定。
 *
 * - 対象は `tests/integration/**`（UT の `vitest.config.ts` とは分離）。
 * - `globalSetup` で Testcontainers の使い捨て PostgreSQL を起動しマイグレーション適用。
 * - `setupFiles` でコンテナの接続 URL を `DATABASE_URL` に注入してから各テストを読み込む。
 * - DB を共有するためファイル間並列は無効化（`fileParallelism: false`）。
 * - コンテナ起動 + migrate があるため hook タイムアウトを長めに設定。
 */
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['./tests/integration/helpers/global-setup.ts'],
    setupFiles: ['./tests/integration/helpers/setup-env.ts'],
    fileParallelism: false,
    hookTimeout: 120000,
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
