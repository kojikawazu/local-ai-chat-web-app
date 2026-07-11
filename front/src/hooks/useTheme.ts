'use client';

import { useState, useCallback, useEffect } from 'react';

/**
 * 選択可能なテーマの識別子。CSS 変数の切り替えキーとして使う。
 */
export type ThemeId = 'nordic' | 'aurora' | 'ocean';

/**
 * 設定 UI に表示する 1 テーマの定義。
 */
export interface ThemeOption {
  /** テーマ識別子 */
  id: ThemeId;
  /** 表示名 */
  name: string;
  /** テーマの説明文 */
  description: string;
}

/**
 * 選択可能な全テーマの定義一覧。設定モーダルの選択肢として使う。
 */
export const THEMES: ThemeOption[] = [
  { id: 'nordic', name: 'Nordic Frost', description: '北欧ブルーのデフォルトテーマ' },
  { id: 'aurora', name: 'Aurora Borealis', description: '紫とシアンのオーロラテーマ' },
  { id: 'ocean', name: 'Midnight Ocean', description: '深海ブルーのダークテーマ' },
];

const STORAGE_KEY = 'nordic-chat-theme';

function readStoredTheme(): ThemeId {
  if (typeof window === 'undefined') return 'nordic';
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && THEMES.some((t) => t.id === saved)) {
    return saved as ThemeId;
  }
  return 'nordic';
}

function applyThemeToDOM(themeId: ThemeId) {
  if (themeId === 'nordic') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', themeId);
  }
}

/**
 * 現在のテーマを管理し、変更を DOM と localStorage に反映するフック。
 *
 * 初期値は localStorage の保存値（無効・未保存なら `nordic`）から復元する。
 *
 * @returns テーマ状態と操作関数。`theme` は現在のテーマ ID、`setTheme` は
 *   テーマを切り替えて localStorage に永続化する関数
 */
export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>(readStoredTheme);

  // テーマが変わるたびにDOMに反映
  useEffect(() => {
    applyThemeToDOM(theme);
  }, [theme]);

  const setTheme = useCallback((newTheme: ThemeId) => {
    setThemeState(newTheme);
    localStorage.setItem(STORAGE_KEY, newTheme);
  }, []);

  return { theme, setTheme };
}
