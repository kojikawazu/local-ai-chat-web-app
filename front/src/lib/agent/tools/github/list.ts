import type { Tool } from '../types';
import { toolError } from '../output';
import { KIND_PARAM, MAX_LIST_LIMIT } from '@/constants/agent/github';
import {
  parseKind,
  parseListLimit,
  parseListState,
  parseRepo,
  repoParam,
} from './args';
import { runGhJson } from './gh';
import { formatList } from './format';

/** PR の一覧で取る項目 */
const PR_LIST_FIELDS =
  'number,title,author,state,isDraft,headRefName,baseRefName,updatedAt,url';

/** issue の一覧で取る項目 */
const ISSUE_LIST_FIELDS = 'number,title,author,state,labels,updatedAt,url';

/**
 * GitHub の PR・issue の一覧を返すツールを作る（#148 Phase C。`docs/17-github-tools.md`）。
 *
 * 承認は要らない（`gh` へ渡すのは検証したリポジトリ・状態・件数だけ）。読んだ内容は非公開のこともあるため
 * `access: 'local'` にし、成功した後はその応答で外部と通信するツールを止める。
 *
 * @param repos - 扱ってよいリポジトリ（`GITHUB_REPOS`）
 * @returns `github_list` のツール
 */
export function createGitHubListTool(repos: string[]): Tool {
  return {
    access: 'local',
    definition: {
      name: 'github_list',
      description:
        'GitHub のリポジトリの PR・issue の一覧を返す（番号・タイトル・状態・作成者・更新日時。新しい順）。' +
        `使えるリポジトリ: ${repos.join(', ')}。1 件の詳細は github_view で見る。`,
      parameters: {
        type: 'object',
        properties: {
          repo: repoParam(repos),
          kind: KIND_PARAM,
          state: {
            type: 'string',
            description:
              '状態で絞る（既定 open）。merged は PR だけ。全部なら all',
            enum: ['open', 'closed', 'merged', 'all'],
          },
          limit: {
            type: 'number',
            description: `件数（既定 10・最大 ${MAX_LIST_LIMIT}）`,
          },
        },
        required: ['repo', 'kind'],
      },
    },
    async execute(args, signal) {
      const repo = parseRepo(args.repo, repos);
      if (!repo.ok) return toolError(repo.reason);
      const kind = parseKind(args.kind);
      if (!kind.ok) return toolError(kind.reason);
      const state = parseListState(args.state, kind.value);
      if (!state.ok) return toolError(state.reason);
      const limit = parseListLimit(args.limit);
      if (!limit.ok) return toolError(limit.reason);

      const json = await runGhJson(
        [
          kind.value,
          'list',
          '--repo',
          repo.value,
          '--state',
          state.value,
          '--limit',
          String(limit.value),
          '--json',
          kind.value === 'pr' ? PR_LIST_FIELDS : ISSUE_LIST_FIELDS,
        ],
        signal
      );
      if (!json.ok) return json.output;
      return formatList(kind.value, repo.value, state.value, json.value);
    },
  };
}
