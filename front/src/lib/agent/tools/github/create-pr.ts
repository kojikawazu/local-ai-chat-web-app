import type { GitHubCreatePrApprovalPreview } from '@/types/agent/tool-call';
import type { Tool } from '../types';
import { toolError, toolNeedsApproval } from '../output';
import {
  parseBranch,
  parseFlag,
  parseRepo,
  parseText,
  repoParam,
} from './args';
import { getRepoInfo, runGh, runGhJson } from './gh';
import { formatCreatePrResult } from './format';

/** PR のタイトルの上限（GitHub の上限） */
const MAX_PR_TITLE_LENGTH = 256;

/** PR の本文の上限。GitHub の上限（65,536 文字）より小さくし、承認カードで読める量にする */
const MAX_PR_BODY_LENGTH = 20_000;

/**
 * 同じブランチの開いた PR の一覧（`gh pr list --json number,url`）から、最初の 1 件を取り出す。
 *
 * @param value - `gh` の JSON
 * @returns 開いた PR の番号と URL。無ければ `null`
 */
function firstOpenPr(value: unknown): { number: number; url: string } | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  // gh の JSON は形が保証されないため、項目を unknown のまま取り出し、直後に型を確かめる
  const { number, url } = (value[0] ?? {}) as {
    number?: unknown;
    url?: unknown;
  };
  return typeof number === 'number'
    ? { number, url: typeof url === 'string' ? url : '' }
    : null;
}

/**
 * GitHub の PR を作るツールを作る（#148 Phase C。`docs/17-github-tools.md`）。
 *
 * 実行前に承認が要る。準備（`prepare`）で引数を確かめ、`base` を省略されたらリポジトリの既定のブランチにし、
 * 同じブランチの開いた PR がもうあれば承認を求めずに失敗にする。ブランチの push はしない（`run_command` の `git push`）。
 * `access` は付けない（{@link createGitHubCommentTool} と同じ理由）。
 *
 * @param repos - 扱ってよいリポジトリ（`GITHUB_REPOS`）
 * @returns `github_create_pr` のツール
 */
export function createGitHubCreatePrTool(repos: string[]): Tool {
  return {
    definition: {
      name: 'github_create_pr',
      description:
        'GitHub に PR を作る。実行前に利用者がタイトル・本文を見て許可する。' +
        `使えるリポジトリ: ${repos.join(', ')}。` +
        'head のブランチは先に push しておく必要がある（このツールは push しない）。',
      parameters: {
        type: 'object',
        properties: {
          repo: repoParam(repos),
          head: {
            type: 'string',
            description: 'PR にするブランチ（push 済みのもの。例: feature/x）',
          },
          base: {
            type: 'string',
            description:
              'マージ先のブランチ（省略時はリポジトリの既定のブランチ）',
          },
          title: {
            type: 'string',
            description: `タイトル（${MAX_PR_TITLE_LENGTH} 文字まで）`,
          },
          body: {
            type: 'string',
            description: `本文（Markdown。${MAX_PR_BODY_LENGTH.toLocaleString()} 文字まで）`,
          },
          draft: {
            type: 'boolean',
            description: '下書きの PR にするなら true（既定 false）',
          },
        },
        required: ['repo', 'head', 'title', 'body'],
      },
    },
    async execute() {
      return toolNeedsApproval();
    },
    async prepare(args, signal) {
      const repo = parseRepo(args.repo, repos);
      if (!repo.ok) return { ok: false, output: toolError(repo.reason) };
      const head = parseBranch(args.head, 'head');
      if (!head.ok) return { ok: false, output: toolError(head.reason) };
      const omitBase =
        args.base === undefined || args.base === null || args.base === '';
      const base = omitBase ? null : parseBranch(args.base, 'base');
      if (base && !base.ok) {
        return { ok: false, output: toolError(base.reason) };
      }
      const title = parseText(args.title, 'title', MAX_PR_TITLE_LENGTH, true);
      if (!title.ok) return { ok: false, output: toolError(title.reason) };
      const body = parseText(args.body, 'body', MAX_PR_BODY_LENGTH);
      if (!body.ok) return { ok: false, output: toolError(body.reason) };

      const repoInfo = await getRepoInfo(repo.value, signal);
      if (!repoInfo.ok) return repoInfo;
      const baseBranch = base ? base.value : repoInfo.info.defaultBranch;
      if (baseBranch === head.value) {
        return {
          ok: false,
          output: toolError(
            `head と base が同じブランチ（${head.value}）です。PR にするブランチを head に指定してください`
          ),
        };
      }

      const existing = await runGhJson(
        [
          'pr',
          'list',
          '--repo',
          repo.value,
          `--head=${head.value}`,
          '--state',
          'open',
          '--json',
          'number,url',
        ],
        signal
      );
      if (!existing.ok) return existing;
      const open = firstOpenPr(existing.value);
      if (open) {
        return {
          ok: false,
          output: toolError(
            `${head.value} の PR はもうあります（PR #${open.number}${open.url ? ` ${open.url}` : ''}）`
          ),
        };
      }

      const preview: GitHubCreatePrApprovalPreview = {
        action: 'github-create-pr',
        repo: repo.value,
        visibility: repoInfo.info.visibility,
        head: head.value,
        base: baseBranch,
        title: title.value,
        body: body.value,
        draft: parseFlag(args.draft),
      };
      return {
        ok: true,
        preview,
        async run(runSignal) {
          // 値は --flag=… の形で渡す（- で始まるタイトル・本文をフラグとして読ませないため）
          const ran = await runGh(
            [
              'pr',
              'create',
              '--repo',
              preview.repo,
              `--head=${preview.head}`,
              `--base=${preview.base}`,
              `--title=${preview.title}`,
              `--body=${preview.body}`,
              ...(preview.draft ? ['--draft'] : []),
            ],
            runSignal
          );
          if (!ran.ok) return ran.output;
          return formatCreatePrResult(preview, ran.stdout);
        },
      };
    },
  };
}
