import { createTwoFilesPatch } from 'diff';
import type { ApprovalPreview } from '@/types/agent/tool-call';

/** 差分の前後に付ける、変更の無い行の数 */
const CONTEXT_LINES = 3;

/**
 * 変更の前後から、承認で見せる内容を作る（#148 Phase A2）。
 *
 * 差分は jsdiff の unified diff（見出しの `===` 行を除く）。追加・削除の行数は、差分の本体（最初の `@@` から後ろ）の
 * `+`・`-` で始まる行を数える。
 *
 * @param action - 何をするか
 * @param file - 対象のファイルの実体のパス
 * @param before - 変更の前の中身（新規なら空文字）
 * @param after - 変更の後の中身
 * @returns 承認で見せる内容
 */
export function buildPreview(
  action: ApprovalPreview['action'],
  file: string,
  before: string,
  after: string
): ApprovalPreview {
  const patch = createTwoFilesPatch(file, file, before, after, '', '', {
    context: CONTEXT_LINES,
  });
  const lines = patch.split('\n').filter((line) => !line.startsWith('==='));
  const bodyStart = lines.findIndex((line) => line.startsWith('@@'));
  const body = bodyStart < 0 ? [] : lines.slice(bodyStart);
  return {
    action,
    path: file,
    diff: lines.join('\n').trimEnd(),
    added: body.filter((line) => line.startsWith('+')).length,
    removed: body.filter((line) => line.startsWith('-')).length,
  };
}

/**
 * 承認で見せる内容の見出し（ツールの結果の要約にも使う）。
 *
 * @param preview - 承認で見せる内容
 * @returns `README.md を編集（+3 −1）` の形
 */
export function describePreview(preview: ApprovalPreview): string {
  const name = preview.path.split('/').at(-1) ?? preview.path;
  const verb = { create: '作成', overwrite: '上書き', edit: '編集' }[
    preview.action
  ];
  return `${name} を${verb}（+${preview.added} −${preview.removed}）`;
}
