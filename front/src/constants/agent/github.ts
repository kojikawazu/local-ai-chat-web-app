import type { ToolDefinition } from '@/lib/agent/tools/types';

/** ツールの引数 1 つの定義（`ToolDefinition` の `properties` の値） */
type ParamSchema = ToolDefinition['parameters']['properties'][string];

/** GitHub の一覧（`github_list`）の件数の上限（#148 Phase C）。モデルの文脈を一覧で埋めない */
export const MAX_LIST_LIMIT = 30;

/** GitHub のツールの `kind` の引数の定義（`github_list`・`github_view`・`github_comment` で共通） */
export const KIND_PARAM: ParamSchema = {
  type: 'string',
  description: '"pr"（Pull Request）か "issue"',
  enum: ['pr', 'issue'],
};

/** GitHub のツールの `number` の引数の定義（`github_view`・`github_pr_diff`・`github_comment` で共通） */
export const NUMBER_PARAM: ParamSchema = {
  type: 'number',
  description: 'PR・issue の番号（例: 193）',
};
