'use client';

import type { KeyboardEvent } from 'react';
import { useCallback } from 'react';
import { LIST_ITEM_ATTRIBUTE } from '@/constants/sidebar/list';
import {
  isListNavigationKey,
  nextListIndex,
} from '@/lib/sidebar/list-navigation';

/**
 * サイドバーの一覧（会話の履歴・検索の結果）を ↑↓・Home・End で移る（#33。`docs/23-keyboard-shortcuts.md`）。
 *
 * 一覧を囲む要素の `onKeyDown` に渡す。フォーカスが行（{@link LIST_ITEM_ATTRIBUTE} の付いた要素）にあるときだけ、
 * フォーカスを前・次・最初・最後の行へ移す（端では止まる）。会話は開かない（Enter・Space はボタンの標準の動き）。
 * 削除のボタン等、行でない要素にフォーカスがあるときは何もしない。
 *
 * @returns 一覧を囲む要素の `onKeyDown` に渡す関数
 */
export function useListNavigation() {
  return useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (
      !isListNavigationKey(event.key) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        `[${LIST_ITEM_ATTRIBUTE}]`
      )
    );
    const current = items.findIndex((item) => item === document.activeElement);
    if (current === -1) return;
    // 行の上では、端で止まっても ↑↓ でページをスクロールさせない
    event.preventDefault();
    const target = nextListIndex(current, event.key, items.length);
    if (target !== null) items[target].focus();
  }, []);
}
