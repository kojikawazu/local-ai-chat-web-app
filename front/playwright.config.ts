import { defineConfig, devices } from '@playwright/test';
import { E2E_OLLAMA_MODEL } from './tests/e2e/helpers/model';

export default defineConfig({
  testDir: './tests/e2e',
  // dev サーバーが E2E_OLLAMA_MODEL で動いているか・モデルを取得済みかを開始前に検証する
  globalSetup: './tests/e2e/helpers/global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    // .env.local の OLLAMA_MODEL（大モデル）より優先される（Next.js は既存の環境変数を上書きしない）。
    // 起動済みのサーバーを再利用した場合は効かないため、global-setup.ts で検証する
    env: { OLLAMA_MODEL: E2E_OLLAMA_MODEL },
  },
});
