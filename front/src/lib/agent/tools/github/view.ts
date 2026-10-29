import type { Tool } from '../types';
import { toolError } from '../output';
import { KIND_PARAM, NUMBER_PARAM } from '@/constants/agent/github';
import { parseItemNumber, parseKind, parseRepo, repoParam } from './args';
import { runGhJson } from './gh';
import { formatView } from './format';

/** PR の詳細で取る項目。CI の結果（statusCheckRollup）もここで取る */
const PR_VIEW_FIELDS =
  'number,title,body,author,state,isDraft,baseRefName,headRefName,url,createdAt,mergedAt,closedAt,additions,deletions,changedFiles,files,labels,reviewDecision,reviews,comments,statusCheckRollup';

/** issue の詳細で取る項目 */
const ISSUE_VIEW_FIELDS =
  'number,title,body,author,state,labels,url,createdAt,closedAt,comments';

/**
 * GitHub の PR・issue の詳細を返すツールを作る（#148 Phase C。`docs/17-github-tools.md`）。
 *
 * PR なら変更したファイル・CI の結果・レビューも返す。承認は要らない。`access` は {@link createGitHubListTool} と同じ理由で `local`。
 *
 * @param repos - 扱ってよいリポジトリ（`GITHUB_REPOS`）
 * @returns `github_view` のツール
 */
export function createGitHubViewTool(repos: string[]): Tool {
  return {
    access: 'local',
    definition: {
      name: 'github_view',
      description:
        'GitHub の PR・issue の詳細を返す（本文・コメント。PR なら変更したファイル・CI の結果・レビューも）。' +
        `使えるリポジトリ: ${repos.join(', ')}。PR の差分は github_pr_diff で見る。`,
      parameters: {
        type: 'object',
        properties: {
          repo: repoParam(repos),
          kind: KIND_PARAM,
          number: NUMBER_PARAM,
        },
        required: ['repo', 'kind', 'number'],
      },
    },
    async execute(args, signal) {
      const repo = parseRepo(args.repo, repos);
      if (!repo.ok) return toolError(repo.reason);
      const kind = parseKind(args.kind);
      if (!kind.ok) return toolError(kind.reason);
      const number = parseItemNumber(args.number);
      if (!number.ok) return toolError(number.reason);

      const json = await runGhJson(
        [
          kind.value,
          'view',
          String(number.value),
          '--repo',
          repo.value,
          '--json',
          kind.value === 'pr' ? PR_VIEW_FIELDS : ISSUE_VIEW_FIELDS,
        ],
        signal
      );
      if (!json.ok) return json.output;
      return formatView(kind.value, repo.value, json.value);
    },
  };
}
