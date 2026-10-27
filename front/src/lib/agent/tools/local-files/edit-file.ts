import { writeFile } from 'fs/promises';
import type { Tool } from '../types';
import { toolError, toolNeedsApproval } from '../output';
import { buildPreview } from './diff';
import { readExistingText, resolveWritablePath } from './write-guard';
import { checkUnchanged, writtenOutput } from './write-file';

/** 置き換える前・後の文字列の最大の文字数（write_file の中身と同じ上限） */
const MAX_STRING_CHARS = 200_000;

/** {@link planEdit} の結果。 */
type EditPlan =
  | {
      ok: true;
      /** 置き換えた後の中身 */
      after: string;
    }
  | {
      ok: false;
      /** 置き換えられない理由（モデルへ返す文章） */
      reason: string;
    };

/**
 * 文字列が中身に何か所あるかを数える（重ならない一致の数）。
 *
 * @param text - 中身
 * @param search - 探す文字列（空でないこと）
 * @returns 一致の数
 */
export function countOccurrences(text: string, search: string): number {
  let count = 0;
  for (
    let index = text.indexOf(search);
    index !== -1;
    index = text.indexOf(search, index + search.length)
  ) {
    count++;
  }
  return count;
}

/**
 * 1 か所だけ一致する文字列を置き換えた後の中身を求める（#148 Phase A2 の `edit_file`）。
 *
 * 改行が CRLF の中身では、置き換える前・後の文字列の `\n` を `\r\n` に揃えてから探す
 * （read_file は行を分けて返すため、モデルは `\r` を含めない）。
 * 置き換えは位置で切り貼りする（`String.replace` は置き換え後の文字列の `$&` 等を特別扱いするため使わない）。
 *
 * @param text - 今の中身
 * @param oldString - 置き換える前の文字列
 * @param newString - 置き換えた後の文字列
 * @returns 置き換えた後の中身。0 か所・2 か所以上・前後が同じなら理由
 */
export function planEdit(
  text: string,
  oldString: string,
  newString: string
): EditPlan {
  const useCrlf = text.includes('\r\n');
  const toFileNewlines = (value: string) =>
    useCrlf ? value.replace(/\r?\n/g, '\r\n') : value;
  const search = toFileNewlines(oldString);
  const replacement = toFileNewlines(newString);
  if (search === replacement) {
    return { ok: false, reason: 'old_string と new_string が同じです' };
  }

  const count = countOccurrences(text, search);
  if (count === 0) {
    return {
      ok: false,
      reason:
        'old_string がファイルの中に見つかりません。read_file で今の中身を確かめ、空白・改行まで同じ文字列を指定してください',
    };
  }
  if (count > 1) {
    return {
      ok: false,
      reason: `old_string がファイルの中に ${count} か所あります。前後の行を足して、1 か所だけに一致するようにしてください`,
    };
  }
  const index = text.indexOf(search);
  return {
    ok: true,
    after:
      text.slice(0, index) + replacement + text.slice(index + search.length),
  };
}

/**
 * ファイルの一部を置き換えるツールを作る（#148 Phase A2）。
 *
 * 実行前に承認が要る（`prepare` で差分を作り、許可されたら `run` で書く）。置き換える前の文字列は、
 * ファイルの中にちょうど 1 か所だけあること。承認を待つ間にファイルが変わっていたら書かない。
 *
 * @param roots - 書き込みのフォルダ（実体のパス）
 * @returns `edit_file` のツール
 */
export function createEditFileTool(roots: string[]): Tool {
  return {
    access: 'local',
    definition: {
      name: 'edit_file',
      description:
        'ローカル PC のテキストファイルの一部を置き換える。old_string はファイルの中にちょうど 1 か所だけある文字列を、' +
        '空白・改行まで正確に指定する（先に read_file で確かめる）。実行前に利用者が差分を見て許可する。' +
        '.env などの秘匿ファイルと .git の中は書き換えられない。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: `編集するファイルの絶対パス。書き込めるフォルダ: ${roots.join(', ')}`,
          },
          old_string: {
            type: 'string',
            description:
              '置き換える前の文字列（ファイルの中にちょうど 1 か所だけあること。行番号は含めない）',
          },
          new_string: {
            type: 'string',
            description: '置き換えた後の文字列',
          },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
    async execute() {
      return toolNeedsApproval();
    },
    async prepare(args) {
      const { old_string: oldString, new_string: newString } = args;
      if (typeof oldString !== 'string' || oldString === '') {
        return {
          ok: false,
          output: toolError(
            'old_string に置き換える前の文字列を指定してください'
          ),
        };
      }
      if (typeof newString !== 'string') {
        return {
          ok: false,
          output: toolError(
            'new_string に置き換えた後の文字列を指定してください'
          ),
        };
      }
      if (
        oldString.length > MAX_STRING_CHARS ||
        newString.length > MAX_STRING_CHARS
      ) {
        return {
          ok: false,
          output: toolError(
            `old_string・new_string は ${MAX_STRING_CHARS.toLocaleString()} 文字以内で指定してください`
          ),
        };
      }
      const target = await resolveWritablePath(args.path, roots);
      if (!target.ok) return { ok: false, output: toolError(target.reason) };
      if (!target.exists) {
        return {
          ok: false,
          output: toolError(
            `「${target.path}」が見つかりません。新しく作るときは write_file を使ってください`
          ),
        };
      }
      const existing = await readExistingText(target.path);
      if (!existing.ok)
        return { ok: false, output: toolError(existing.reason) };

      const plan = planEdit(existing.text, oldString, newString);
      if (!plan.ok) return { ok: false, output: toolError(plan.reason) };

      const preview = buildPreview(
        'edit',
        target.path,
        existing.text,
        plan.after
      );
      return {
        ok: true,
        preview,
        async run() {
          const changed = await checkUnchanged(target.path, existing.hash);
          if (changed) return toolError(changed);
          try {
            await writeFile(target.path, plan.after, 'utf8');
          } catch {
            return toolError(`「${target.path}」に書き込めませんでした`);
          }
          return writtenOutput(preview);
        },
      };
    },
  };
}
