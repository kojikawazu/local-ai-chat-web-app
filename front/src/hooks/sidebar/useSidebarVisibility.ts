'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  parseSidebarVisibility,
  serializeSidebarVisibility,
} from '@/lib/sidebar/visibility';

/** サイドバーの表示状態の保存先（localStorage のキー） */
const STORAGE_KEY = 'nordic-chat-sidebar';

/**
 * デスクトップのサイドバーの表示・非表示を管理し、localStorage に保存するフック（#24）。
 *
 * 保存値はマウントしてから読む（`useAgentSettings` と同じ。SSR の描画と食い違わないように）。
 * 読み終えるまでは `isReady` が `false` で、呼び出し側はその間、幅のアニメーションを付けない
 * （非表示を保存していたとき、閉じる動きが見えないように）。ストレージが使えない環境（読み書きで例外）でも、
 * 表示で始めて切り替えは続けられるようにする。
 *
 * @returns `isOpen` はサイドバーを表示するか、`isReady` は保存値を読み終えたか、`toggle` は表示を切り替えて保存する関数
 */
export function useSidebarVisibility() {
  const [isOpen, setIsOpen] = useState(true);
  const [isReady, setIsReady] = useState(false);

  // why: 遅延初期化（useState(() => localStorage...)）は SSR 時に localStorage へ触れ、ハイドレーションが
  // 食い違う。ハイドレーション後の effect で一度だけ同期するため、set-state-in-effect はここに限り無効化する
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      // プライベートモード・ストレージの無効化などで読めない。表示のまま始める
      console.error('Failed to read sidebar visibility:', error);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 上記 why 参照（client-only 同期）
    setIsOpen(parseSidebarVisibility(stored));
    setIsReady(true);
  }, []);

  // 保存は updater の外で行う（updater は純粋に保つ。StrictMode では 2 回呼ばれる）
  const toggle = useCallback(() => {
    const next = !isOpen;
    setIsOpen(next);
    try {
      localStorage.setItem(STORAGE_KEY, serializeSidebarVisibility(next));
    } catch (error) {
      // 保存できなくても、この画面の中では切り替えを続ける
      console.error('Failed to save sidebar visibility:', error);
    }
  }, [isOpen]);

  return { isOpen, isReady, toggle };
}
