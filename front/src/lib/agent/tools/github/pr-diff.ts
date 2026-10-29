import type { Tool } from '../types';
import { toolError } from '../output';
import { NUMBER_PARAM } from '@/constants/agent/github';
import { parseDiffFile, parseItemNumber, parseRepo, repoParam } from './args';
import { runGh } from './gh';
import { formatDiff } from './format';

/**
 * GitHub の PR の差分を返すツールを作る（#148 Phase C。`docs/17-github-tools.md`）。
 *
 * `file` は `gh` に渡さず、アプリの中で差分を絞るのに使う（外へ出ない）。承認は要らない。`access` は `local`。
 *
 * @param repos - 扱ってよいリポジトリ（`GITHUB_REPOS`）
 * @returns `github_pr_diff` のツール
 */
export function createGitHubPrDiffTool(repos: string[]): Tool {
  return {
    access: 'local',
    definition: {
      name: 'github_pr_diff',
      description:
        'GitHub の PR の差分（unified diff）を返す。' +
        `使えるリポジトリ: ${repos.join(', ')}。` +
        '大きい PR は途中が省略されるため、github_view で変更したファイルを確かめてから file で 1 つに絞る。',
      parameters: {
        type: 'object',
        properties: {
          repo: repoParam(repos),
          number: { ...NUMBER_PARAM, description: 'PR の番号（例: 193）' },
          file: {
            type: 'string',
            description:
              'このファイルの差分だけを返す（github_view の変更したファイルのパス。省略時は全体）',
          },
        },
        required: ['repo', 'number'],
      },
    },
    async execute(args, signal) {
      const repo = parseRepo(args.repo, repos);
      if (!repo.ok) return toolError(repo.reason);
      const number = parseItemNumber(args.number);
      if (!number.ok) return toolError(number.reason);
      const file = parseDiffFile(args.file);
      if (!file.ok) return toolError(file.reason);

      const ran = await runGh(
        [
          'pr',
          'diff',
          String(number.value),
          '--repo',
          repo.value,
          '--color=never',
        ],
        signal
      );
      if (!ran.ok) return ran.output;
      return formatDiff(repo.value, number.value, ran.stdout, file.value);
    },
  };
}
