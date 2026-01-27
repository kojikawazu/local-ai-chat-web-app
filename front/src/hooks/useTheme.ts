'use client';

import { useState, useCallback, useEffect } from 'react';

export type ThemeId = 'nordic' | 'aurora' | 'ocean';

export interface ThemeOption {
  id: ThemeId;
  name: string;
  description: string;
}

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
