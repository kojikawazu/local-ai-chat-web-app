import path from 'path';
import { defineConfig, devices } from '@playwright/test';
import { E2E_OLLAMA_MODEL } from './tests/e2e/helpers/model';
import {
  E2E_LOCAL_FILES_DIR,
  E2E_WRITE_DIR,
} from './tests/e2e/helpers/local-files';
import { E2E_FAKE_GH_DIR, E2E_GITHUB_REPO } from './tests/e2e/helpers/github';
import {
  E2E_BROWSER_FIXTURE_DIR,
  E2E_BROWSER_FIXTURE_ORIGIN,
  E2E_BROWSER_FIXTURE_PORT,
} from './tests/e2e/helpers/browser';

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
  webServer: [
    {
      command: 'pnpm dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      // .env.local の OLLAMA_MODEL（大モデル）より優先される（Next.js は既存の環境変数を上書きしない）。
      // 起動済みのサーバーを再利用した場合は効かないため、global-setup.ts で検証する
      // LOCAL_FILE_ROOTS も同じく、.env.local の値（開発者のフォルダ）ではなく E2E 用のフォルダだけを読ませる（#148）
      env: {
        OLLAMA_MODEL: E2E_OLLAMA_MODEL,
        LOCAL_FILE_ROOTS: `${E2E_LOCAL_FILES_DIR},${E2E_WRITE_DIR}`,
        // 書き込みは OS の一時フォルダの E2E 用のフォルダだけ（#148 Phase A2）
        LOCAL_FILE_WRITE_ROOTS: E2E_WRITE_DIR,
        // コマンドの実行は node だけ（#148 Phase B）。どの環境にもあり、作業フォルダは上の書き込みのフォルダに限られる
        LOCAL_COMMANDS: 'node',
        // GitHub のツールは架空のリポジトリだけ（#148 Phase C）。偽の gh を PATH の先頭に置き、本物の GitHub に触れない
        GITHUB_REPOS: E2E_GITHUB_REPO,
        PATH: [E2E_FAKE_GH_DIR, process.env.PATH ?? ''].join(path.delimiter),
        // ブラウザのツールは、確認用のページのサーバーだけを手元の開発サーバーとして開ける（#149）
        BROWSER_ENABLED: 'true',
        BROWSER_LOCAL_ORIGINS: E2E_BROWSER_FIXTURE_ORIGIN,
      },
    },
    {
      // ブラウザのツール（#149）で開かせる確認用のページを配る
      command: `node tests/e2e/helpers/browser-fixture-server.mjs "${E2E_BROWSER_FIXTURE_DIR}" ${E2E_BROWSER_FIXTURE_PORT}`,
      url: `${E2E_BROWSER_FIXTURE_ORIGIN}/`,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
