'use client';

import { useState, useCallback, useEffect } from 'react';
import type { ThemeId } from '@/types/theme';
import { THEMES } from '@/types/theme';

const STORAGE_KEY = 'nordic-chat-theme';

/** 未保存・無効値のときに使う既定テーマ。`data-theme` 属性を付けない状態に対応する。 */
const DEFAULT_THEME_ID: ThemeId = 'nordic';

/**
 * 文字列が有効なテーマ識別子かを判定する。
 *
 * localStorage の値は書き換えられ得る外部入力なので、`as ThemeId` で通さず
 * {@link THEMES} の定義と突き合わせて絞り込む。
 *
 * @param value - 検証対象の文字列（localStorage 由来を想定）
 * @returns THEMES に存在する識別子なら true
 */
function isThemeId(value: string): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}

/**
 * localStorage に保存されたテーマを読み出す。
 *
 * @returns 保存済みの有効なテーマ識別子。SSR 時・未保存・無効値なら既定テーマ
 */
function readStoredTheme(): ThemeId {
  if (typeof window === 'undefined') return DEFAULT_THEME_ID;
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved !== null && isThemeId(saved)) {
    return saved;
  }
  return DEFAULT_THEME_ID;
}

/**
 * テーマを `data-theme` 属性として `<html>` に反映する。
 *
 * @param themeId - 反映するテーマ識別子。既定テーマは属性を外して表現する
 */
function applyThemeToDOM(themeId: ThemeId) {
  if (themeId === DEFAULT_THEME_ID) {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', themeId);
  }
}

/**
 * 現在のテーマを管理し、変更を DOM と localStorage に反映するフック。
 *
 * 初期値は localStorage の保存値（無効・未保存なら既定テーマ）から復元する。
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
