import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * ユニットテスト（UT）用の Vitest 設定。
 *
 * - 対象は `tests/unit/**` のみ（E2E は Playwright が `tests/e2e/` を担当し重複しない）。
 * - 純ロジックの UT が中心のため environment は `node`（DOM 不要）。
 * - アプリと同じ `@/*` → `src/*` エイリアスを解決し、import 記法を揃える。
 */
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
