import { writeFile } from 'fs/promises';
import type { Tool, ToolExecution } from '../types';
import { toolError } from '../output';
import type { ApprovalPreview } from '@/types/agent/tool-call';
import { buildPreview, describePreview } from './diff';
import { readExistingText, resolveWritablePath } from './write-guard';

/** 1 回に書き込む中身の最大の文字数。モデルがこれを超える量を一度に書くのは現実的でなく、誤って巨大な文字列を書かせない */
const MAX_CONTENT_CHARS = 200_000;

/** 承認を求めずに実行されたときの理由（承認の要るツールは、エージェントループが prepare から進める） */
const NEEDS_APPROVAL_REASON =
  'このツールは利用者の承認が必要なため、ここでは実行できません';

/**
 * 書き込んだことを、モデルへ返す結果にする。
 *
 * @param preview - 承認で見せた内容
 * @returns 書き込んだ結果。見出しは承認で見せた見出しと同じ
 */
export function writtenOutput(preview: ApprovalPreview): ToolExecution {
  const verb = { create: '作成', overwrite: '上書き', edit: '編集' }[
    preview.action
  ];
  return {
    result: `${preview.path} を${verb}しました（+${preview.added} −${preview.removed} 行）`,
    isError: false,
    summary: describePreview(preview),
  };
}

/**
 * 準備した時点から、書き込む先が変わっていないかを確かめる。
 *
 * @param file - 書き込む先
 * @param beforeHash - 準備した時点の中身のハッシュ。新規なら `null`
 * @returns 変わっていなければ `null`、変わっていれば理由
 */
export async function checkUnchanged(
  file: string,
  beforeHash: string | null
): Promise<string | null> {
  const changed =
    'このファイルは、承認を待つ間に変わったため書き込みませんでした。読み直してからやり直してください';
  if (beforeHash === null) return null; // 新規は書くときの 'wx' で、既にできていれば失敗させる
  const current = await readExistingText(file);
  return current.ok && current.hash === beforeHash ? null : changed;
}

/**
 * ファイルを作成・上書きするツールを作る（#148 Phase A2）。
 *
 * 実行前に承認が要る（`prepare` で差分を作り、許可されたら `run` で書く）。親のフォルダは既にあること。
 * 上書きでは、承認を待つ間にファイルが変わっていたら書かない。中身が同じなら書かない。
 *
 * @param roots - 書き込みのフォルダ（実体のパス）
 * @returns `write_file` のツール
 */
export function createWriteFileTool(roots: string[]): Tool {
  return {
    access: 'local',
    definition: {
      name: 'write_file',
      description:
        'ローカル PC のテキストファイルを作成するか、中身の全体を書き換える。実行前に利用者が差分を見て許可する。' +
        '一部だけを直すときは edit_file を使う。親のフォルダは既にあること。.env などの秘匿ファイルと .git の中には書けない。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: `書き込むファイルの絶対パス。書き込めるフォルダ: ${roots.join(', ')}`,
          },
          content: {
            type: 'string',
            description: 'ファイルの中身の全体',
          },
        },
        required: ['path', 'content'],
      },
    },
    async execute() {
      return toolError(NEEDS_APPROVAL_REASON);
    },
    async prepare(args) {
      const { content } = args;
      if (typeof content !== 'string') {
        return {
          ok: false,
          output: toolError('content に中身を指定してください'),
        };
      }
      if (content.length > MAX_CONTENT_CHARS) {
        return {
          ok: false,
          output: toolError(
            `content が長すぎます（${content.length.toLocaleString()} 文字。上限 ${MAX_CONTENT_CHARS.toLocaleString()} 文字）`
          ),
        };
      }
      const target = await resolveWritablePath(args.path, roots);
      if (!target.ok) return { ok: false, output: toolError(target.reason) };

      let before = '';
      let beforeHash: string | null = null;
      if (target.exists) {
        const existing = await readExistingText(target.path);
        if (!existing.ok)
          return { ok: false, output: toolError(existing.reason) };
        if (existing.text === content) {
          return {
            ok: false,
            output: toolError('今の中身と同じため、書き込む必要はありません'),
          };
        }
        before = existing.text;
        beforeHash = existing.hash;
      }

      const preview = buildPreview(
        target.exists ? 'overwrite' : 'create',
        target.path,
        before,
        content
      );
      return {
        ok: true,
        preview,
        async run() {
          const changed = await checkUnchanged(target.path, beforeHash);
          if (changed) return toolError(changed);
          try {
            // 新規は 'wx'（既にあれば失敗）。承認を待つ間に同じ名前のファイルができていたら上書きしない
            await writeFile(target.path, content, {
              encoding: 'utf8',
              flag: target.exists ? 'w' : 'wx',
            });
          } catch {
            return toolError(
              target.exists
                ? `「${target.path}」に書き込めませんでした`
                : `「${target.path}」を作成できませんでした（承認を待つ間に同じ名前のファイルができた可能性があります）`
            );
          }
          return writtenOutput(preview);
        },
      };
    },
  };
}
