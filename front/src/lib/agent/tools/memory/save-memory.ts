import type { Tool, ToolExecution } from '../types';
import { toolError, toolNeedsApproval } from '../output';
import {
  MAX_MEMORY_CONTENT_CHARS,
  MAX_MEMORY_DESCRIPTION_CHARS,
  MAX_MEMORY_NAME_LENGTH,
  MIN_MEMORY_NAME_LENGTH,
  validateMemoryInput,
} from '@/lib/knowledge/memory';
import type { VaultRoot } from '@/lib/knowledge/vault';
import { SAVE_MEMORY_TOOL_NAME } from '@/constants/knowledge/memory';
import { prepareMemoryWrite } from '@/lib/server/knowledge-memory';
import type { MemoryWriteResult } from '@/lib/server/knowledge-memory';
import { MEMORY_TYPES } from '@/types/knowledge/memory';

/**
 * 承認の後の実行（書き込み・コミット・索引への反映）の時間の上限（ミリ秒）。埋め込みのモデルを初めて読み込むと
 * 数十秒かかることがあり、ツール全般の上限（既定 30 秒）では足りないため長くする
 */
const SAVE_MEMORY_RUN_TIMEOUT_MS = 120_000;

/**
 * 書いた結果を、モデルへ返す結果にする。
 *
 * コミットに失敗したら（索引に入らず、次の会話で引けないため）失敗として返す。書いたファイルは残っていることも伝える。
 * 索引にだけ入れられなかったときは、保存はできているので成功として返し、理由を足す。
 *
 * @param written - 書いた結果
 * @returns モデルへ返す結果
 */
export function memoryWrittenOutput(
  written: Extract<MemoryWriteResult, { ok: true }>
): ToolExecution {
  const verb = written.mode === 'create' ? '作成' : '更新';
  const parts = [`${written.displayPath} を${verb}しました`];
  if (written.commit) parts.push(`コミットしました（${written.commit}）`);
  if (written.commitError) {
    parts.push(
      `ただし、コミットできませんでした（${written.commitError}）。ファイルは書いたまま残っています`
    );
  }
  parts.push(
    written.indexed
      ? '索引に入れました（次の会話から「ドキュメントを参照」で引けます）'
      : (written.indexError ?? '索引に入れていません')
  );
  const summary = `${written.displayPath.split('/').at(-1)} を${verb}${
    written.commitError ? '（コミットに失敗）' : ''
  }`;
  return {
    result: parts.join('。'),
    isError: written.commitError !== null,
    summary,
  };
}

/**
 * 会話から覚えさせたことをメモの保管庫に書くツールを作る（#236。`docs/28-rag.md`「会話から覚えさせる（Phase D）」）。
 *
 * 実行前に承認が要る（`prepare` で置き場所と差分を作り、許可されたら `run` で書く）。書く場所はアプリが名前から決め
 * （`memories/<名前>.md`）、frontmatter もアプリが組み立てる。git の保管庫なら既定のブランチへコミットし（push しない）、
 * そのファイルだけを索引に入れる。
 *
 * @param vault - メモの保管庫（`KNOWLEDGE_MEMORY_VAULT`）
 * @returns `save_memory` のツール
 */
export function createSaveMemoryTool(vault: VaultRoot): Tool {
  return {
    // 手元のフォルダに書く（外部と通信しない）。手元の情報を読んだ後でも止めない
    access: 'local',
    runTimeoutMs: SAVE_MEMORY_RUN_TIMEOUT_MS,
    definition: {
      name: SAVE_MEMORY_TOOL_NAME,
      description:
        '利用者が「覚えておいて」「メモして」と頼んだことを、メモの保管庫に 1 件 1 ファイルで保存する。次の会話から「ドキュメントを参照」で引ける。' +
        '利用者が頼んだときだけ使い、自分から覚えに行かない。前に同じことを覚えていれば（参照したドキュメントに memories/<名前>.md があれば）同じ name で更新する。' +
        // 「利用者が許可する」とだけ書くと、モデルが呼ぶ前に文章で確認を取りにいき、呼ばずに応答を終えた（qwen3.8:27b で確かめた）
        '呼ぶと画面が利用者に中身を見せて許可を求めるため、文章で「保存してよいか」と確認せずにそのまま呼ぶ。パスワード・API キー等は保存しない。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: `メモの名前（ファイル名になる）。英小文字・数字を - でつないだ ${MIN_MEMORY_NAME_LENGTH}〜${MAX_MEMORY_NAME_LENGTH} 字（例: coffee-preference）`,
          },
          description: {
            type: 'string',
            description: `何のメモかを表す 1 行（${MAX_MEMORY_DESCRIPTION_CHARS} 字まで）`,
          },
          type: {
            type: 'string',
            description:
              'メモの種類。user: 利用者のこと / preference: 好み・やり方 / project: 進めていること / reference: 参照先 / fact: 事実・知識',
            enum: [...MEMORY_TYPES],
          },
          content: {
            type: 'string',
            description: `覚える内容（Markdown。${MAX_MEMORY_CONTENT_CHARS.toLocaleString()} 字まで）。後から読んで分かるよう、頼まれたことを具体的に書く`,
          },
        },
        required: ['name', 'description', 'type', 'content'],
      },
    },
    async execute() {
      return toolNeedsApproval();
    },
    async prepare(args) {
      const input = validateMemoryInput(args);
      if (!input.ok) return { ok: false, output: toolError(input.error) };
      const prepared = await prepareMemoryWrite(vault, input.value);
      if (!prepared.ok) {
        return { ok: false, output: toolError(prepared.error) };
      }
      return {
        ok: true,
        preview: prepared.preview,
        async run() {
          const written = await prepared.write();
          return written.ok
            ? memoryWrittenOutput(written)
            : toolError(written.error);
        },
      };
    },
  };
}
