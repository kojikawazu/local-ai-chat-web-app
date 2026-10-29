import type { GitHubCommentApprovalPreview } from '@/types/agent/tool-call';
import { KIND_PARAM, NUMBER_PARAM } from '@/constants/agent/github';
import type { Tool } from '../types';
import { toolError, toolNeedsApproval } from '../output';
import {
  parseItemNumber,
  parseKind,
  parseRepo,
  parseText,
  repoParam,
} from './args';
import { getRepoInfo, runGh, runGhJson } from './gh';
import { formatCommentResult, kindLabel } from './format';

/** コメントの本文の上限。GitHub の上限（65,536 文字）より小さくし、承認カードで読める量にする */
const MAX_COMMENT_BODY_LENGTH = 10_000;

/**
 * GitHub の PR・issue にコメントするツールを作る（#148 Phase C。`docs/17-github-tools.md`）。
 *
 * 実行前に承認が要る。準備（`prepare`）で引数を確かめ、コメント先のタイトルとリポジトリの公開・非公開を取って承認カードに出す
 * （コメント先が無ければ承認を求めずに失敗にする）。許可されたら、準備で決めたコメント先と本文をそのまま送る。
 * `access` は付けない（ファイルを読んだ後でも止めず、承認を守りにする。返すのは URL だけ）。
 *
 * @param repos - 扱ってよいリポジトリ（`GITHUB_REPOS`）
 * @returns `github_comment` のツール
 */
export function createGitHubCommentTool(repos: string[]): Tool {
  return {
    definition: {
      name: 'github_comment',
      description:
        'GitHub の PR・issue にコメントする。実行前に利用者が本文を見て許可する。' +
        `使えるリポジトリ: ${repos.join(', ')}。`,
      parameters: {
        type: 'object',
        properties: {
          repo: repoParam(repos),
          kind: KIND_PARAM,
          number: NUMBER_PARAM,
          body: {
            type: 'string',
            description: `コメントの本文（Markdown。${MAX_COMMENT_BODY_LENGTH.toLocaleString()} 文字まで）`,
          },
        },
        required: ['repo', 'kind', 'number', 'body'],
      },
    },
    async execute() {
      return toolNeedsApproval();
    },
    async prepare(args, signal) {
      const repo = parseRepo(args.repo, repos);
      if (!repo.ok) return { ok: false, output: toolError(repo.reason) };
      const kind = parseKind(args.kind);
      if (!kind.ok) return { ok: false, output: toolError(kind.reason) };
      const number = parseItemNumber(args.number);
      if (!number.ok) return { ok: false, output: toolError(number.reason) };
      const body = parseText(args.body, 'body', MAX_COMMENT_BODY_LENGTH);
      if (!body.ok) return { ok: false, output: toolError(body.reason) };

      const target = await runGhJson(
        [
          kind.value,
          'view',
          String(number.value),
          '--repo',
          repo.value,
          '--json',
          'title',
        ],
        signal
      );
      if (!target.ok) return target;
      // gh の JSON は形が保証されないため、title を unknown のまま取り出し、次の行で文字列かを確かめる
      const title = (target.value as { title?: unknown } | null)?.title;
      if (typeof title !== 'string') {
        return {
          ok: false,
          output: toolError(
            `${kindLabel(kind.value)} #${number.value} のタイトルを読めませんでした`
          ),
        };
      }
      const repoInfo = await getRepoInfo(repo.value, signal);
      if (!repoInfo.ok) return repoInfo;

      const preview: GitHubCommentApprovalPreview = {
        action: 'github-comment',
        repo: repo.value,
        visibility: repoInfo.info.visibility,
        kind: kind.value,
        number: number.value,
        targetTitle: title,
        body: body.value,
      };
      return {
        ok: true,
        preview,
        async run(runSignal) {
          // 本文は --body=… の形で渡す（--body … だと、- で始まる本文をフラグとして読まれうるため）
          const ran = await runGh(
            [
              preview.kind,
              'comment',
              String(preview.number),
              '--repo',
              preview.repo,
              `--body=${preview.body}`,
            ],
            runSignal
          );
          if (!ran.ok) return ran.output;
          return formatCommentResult(preview, ran.stdout);
        },
      };
    },
  };
}
