import { DEFAULT_CONVERSATION_TITLE } from '@/constants/conversation/title';
import { MAX_TITLE_LENGTH } from '@/lib/shared/validation';

/**
 * 会話の分岐（#29。`docs/22-conversation-fork.md`）で、コピーする会話・メッセージを組み立てる純関数群。
 *
 * 分岐の API（`POST /api/conversations/[id]/fork`）から使う。Prisma の実体には依存させない。
 */

// 分岐した会話のタイトルの末尾に付ける印
const FORK_TITLE_SUFFIX = '（分岐）';

/**
 * 分岐した会話のタイトルを作る。元のタイトルの後ろに `（分岐）` を付ける。
 *
 * もう `（分岐）` で終わっていれば足さない（分岐した会話からさらに分岐しても `（分岐）（分岐）` と重ねない）。
 * 会話のタイトルの上限（{@link MAX_TITLE_LENGTH}。UTF-16 の長さ）に収まるよう元のタイトルを後ろから削る。
 * 文字単位（コードポイント）で削り、サロゲートペアを割らない。元のタイトルが空白だけなら既定のタイトルを元にする。
 *
 * @param title - 分岐元の会話のタイトル
 * @returns 分岐した会話のタイトル（`MAX_TITLE_LENGTH` 以内）
 */
export function toForkTitle(title: string): string {
  const base = title.trim() || DEFAULT_CONVERSATION_TITLE;
  if (base.endsWith(FORK_TITLE_SUFFIX) && base.length <= MAX_TITLE_LENGTH) {
    return base;
  }
  const chars = Array.from(base);
  let head = base;
  while (head.length + FORK_TITLE_SUFFIX.length > MAX_TITLE_LENGTH) {
    chars.pop();
    head = chars.join('');
  }
  return `${head}${FORK_TITLE_SUFFIX}`;
}

/**
 * 値が配列でないオブジェクトかを判定する。
 *
 * @param value - 判定する値
 * @returns 配列でないオブジェクトなら true
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 応答の metadata の中のツールの画面の ID（`toolCalls[].screenshots[].id`。#200）を、コピーした添付画像の ID に書き換える。
 *
 * 分岐では添付画像を新しい ID でコピーするため、metadata の参照も同じ ID に揃える（揃えないと、分岐した会話で画面が出ない）。
 * 対応の無い ID・形の合わない要素はそのまま残す（コピーは元と同じものを作る。表示の側が今と同じく捨てる）。
 * 元の metadata は書き換えず、変わる部分だけを作り直した新しい値を返す。
 *
 * @param metadata - コピー元のメッセージの metadata（DB の JSON。`null` もありうる）
 * @param idMap - 元の添付画像の ID → コピーした添付画像の ID
 * @returns ID を書き換えた metadata。書き換える所が無ければ引数と同じ値
 */
export function remapScreenshotIds(
  metadata: unknown,
  idMap: ReadonlyMap<string, string>
): unknown {
  if (!isRecord(metadata) || !Array.isArray(metadata.toolCalls)) {
    return metadata;
  }
  let changed = false;
  const toolCalls = metadata.toolCalls.map((call: unknown) => {
    if (!isRecord(call) || !Array.isArray(call.screenshots)) return call;
    let callChanged = false;
    const screenshots = call.screenshots.map((shot: unknown) => {
      if (!isRecord(shot) || typeof shot.id !== 'string') return shot;
      const next = idMap.get(shot.id);
      if (next === undefined) return shot;
      callChanged = true;
      return { ...shot, id: next };
    });
    if (!callChanged) return call;
    changed = true;
    return { ...call, screenshots };
  });
  return changed ? { ...metadata, toolCalls } : metadata;
}
