/**
 * サイドバーの会話の一覧をキーで移るときの移る先を決める純関数群（#33。`docs/23-keyboard-shortcuts.md`）。
 *
 * どれも端で止まる（一番上で ↑・一番下で ↓ を押しても、反対の端へ回らない）。
 */

/** 一覧の中でフォーカスを移すキー。 */
export type ListNavigationKey = 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

/** 一覧の中でフォーカスを移すキーの一覧（`KeyboardEvent.key` の判定に使う）。 */
const LIST_NAVIGATION_KEYS: readonly string[] = [
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
];

/**
 * キーが一覧の中でフォーカスを移すキーかを判定する。
 *
 * @param key - `KeyboardEvent.key`
 * @returns ↑・↓・Home・End なら true
 */
export function isListNavigationKey(key: string): key is ListNavigationKey {
  return LIST_NAVIGATION_KEYS.includes(key);
}

/**
 * 一覧の中で、キーを押したときに移る先の位置を決める。
 *
 * @param current - 今フォーカスがある行の位置（0 始まり）
 * @param key - 押したキー
 * @param length - 一覧の行の数
 * @returns 移る先の位置。動かない（端で ↑↓・もうその行にいる・空の一覧）なら `null`
 */
export function nextListIndex(
  current: number,
  key: ListNavigationKey,
  length: number
): number | null {
  if (length === 0) return null;
  const target =
    key === 'Home'
      ? 0
      : key === 'End'
        ? length - 1
        : Math.min(
            Math.max(current + (key === 'ArrowDown' ? 1 : -1), 0),
            length - 1
          );
  return target === current ? null : target;
}

/**
 * 前・次の会話（Ctrl+Shift+↑ / ↓）の移る先の会話を決める。並びはサイドバーの一覧（更新の新しい順）。
 *
 * 開いている会話が一覧に無い（新しい会話のモード・作った直後で一覧の読み直しの前）ときは、次は一番上の会話、前は無し。
 *
 * @param ids - サイドバーの並びの会話の ID
 * @param currentId - 開いている会話の ID（新しい会話のモードでは `null`）
 * @param direction - `previous` は一覧の上、`next` は下
 * @returns 移る先の会話の ID。端・空の一覧で動かないなら `null`
 */
export function adjacentConversationId(
  ids: readonly string[],
  currentId: string | null,
  direction: 'previous' | 'next'
): string | null {
  const index = currentId === null ? -1 : ids.indexOf(currentId);
  if (index === -1) {
    return direction === 'next' ? (ids[0] ?? null) : null;
  }
  const target = nextListIndex(
    index,
    direction === 'next' ? 'ArrowDown' : 'ArrowUp',
    ids.length
  );
  return target === null ? null : ids[target];
}
