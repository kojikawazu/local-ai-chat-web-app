import { mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { FakeGhRule } from '../../integration/helpers/fake-gh';

/**
 * E2E の dev サーバーに `GITHUB_REPOS` として渡す、架空のリポジトリ（#148 Phase C）。
 *
 * `playwright.config.ts`（dev サーバーへ渡す）と `github-tools.spec.ts`（モデルへの頼み方・偽の gh の応答）が同じ値を使うため、
 * ここを唯一の定義にする。偽の gh だけが応答し、本物の GitHub には触れない。
 */
export const E2E_GITHUB_REPO = 'e2e-owner/e2e-repo';

/**
 * E2E の偽の `gh` を置くフォルダ（#148 Phase C）。`playwright.config.ts` が dev サーバーの `PATH` の先頭に足す。
 *
 * 偽の gh は IT と同じもの（`tests/integration/helpers/fake-gh.ts`）で、spec が開始前に置く。拡張子の無いスクリプトを
 * package.json の無い場所で動かすため、OS の一時フォルダに置く。`PATH` に足すフォルダは起動時にあるとよいため、
 * 読み込んだ時点で作っておく（中身は spec が置く）。
 */
export const E2E_FAKE_GH_DIR = path.join(tmpdir(), 'nordic-chat-e2e-gh');
mkdirSync(E2E_FAKE_GH_DIR, { recursive: true });

/** E2E の偽の gh の応答（{@link E2E_GITHUB_REPO} の PR 2 件・issue #1・存在しない PR #999） */
export const E2E_FAKE_GH_RULES: FakeGhRule[] = [
  {
    args: ['repo', 'view', E2E_GITHUB_REPO],
    stdout: JSON.stringify({
      visibility: 'PUBLIC',
      defaultBranchRef: { name: 'main' },
    }),
  },
  {
    args: ['pr', 'list', '--repo', E2E_GITHUB_REPO],
    stdout: JSON.stringify([
      {
        number: 2,
        title: 'E2E の 2 つ目の PR',
        state: 'OPEN',
        author: { login: 'e2e-user' },
        headRefName: 'feature/second',
        baseRefName: 'main',
        updatedAt: '2026-10-29T00:00:00Z',
      },
      {
        number: 1,
        title: 'E2E の 1 つ目の PR',
        state: 'OPEN',
        author: { login: 'e2e-user' },
        headRefName: 'feature/first',
        baseRefName: 'main',
        updatedAt: '2026-10-28T00:00:00Z',
      },
    ]),
  },
  {
    args: ['issue', 'view', '1', '--repo', E2E_GITHUB_REPO],
    stdout: JSON.stringify({ title: 'E2E の質問' }),
  },
  {
    args: ['pr', 'view', '999', '--repo', E2E_GITHUB_REPO],
    stderr:
      'GraphQL: Could not resolve to a PullRequest with the number of 999. (repository.pullRequest)\n',
    exitCode: 1,
  },
  {
    args: ['issue', 'comment'],
    stdout: `https://github.com/${E2E_GITHUB_REPO}/issues/1#issuecomment-1\n`,
  },
];
