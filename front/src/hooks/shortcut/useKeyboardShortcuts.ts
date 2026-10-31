'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { matchShortcut } from '@/lib/shortcut/match';
import { readIsMac } from '@/hooks/shortcut/useIsMac';
import type { ShortcutId } from '@/types/shortcut/shortcut';

/** 操作ごとに呼ぶ関数。省いた操作のキーは受けない（ブラウザの既定の動きのままにする） */
type ShortcutHandlers = Partial<Record<ShortcutId, () => void>>;

/** {@link useKeyboardShortcuts} の設定。 */
type UseKeyboardShortcutsOptions = {
  /** 操作ごとに呼ぶ関数 */
  handlers: ShortcutHandlers;
  /** ショートカットを受けない間は true（ドロワーが開いている間など。モーダル（`<dialog open>`）はここで見る） */
  blocked: boolean;
};

/**
 * 要素が文字を打つ欄かを判定する（`?` を文字として打たせるため）。
 *
 * @param element - フォーカスのある要素
 * @returns `input`（ボタン類を除く）・`textarea`・`select`・編集できる要素なら true
 */
function isTextField(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLSelectElement) return true;
  if (element instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'submit', 'reset'].includes(
      element.type
    );
  }
  return false;
}

/**
 * ページ全体のショートカット（#33。`docs/23-keyboard-shortcuts.md`）を受け、操作ごとの関数を呼ぶ。
 *
 * `document` の keydown を受け、キーの判定は {@link matchShortcut} に任せる。モーダル（`<dialog open>`）・ドロワーが
 * 開いている間・IME の変換中は受けない。受けたら `preventDefault` して、ブラウザの既定の動き（⌘K・⌘B 等）を止める。
 * 関数は最新のものを ref で読む（描画のたびに listener を付け直さない）。ref は `useLayoutEffect` で描画の直後に入れ替える。
 * `useEffect` だと画面が変わってから入れ替わるまでに間があり、その間に押されたキーが古い状態の関数で動く
 * （会話を選んだ直後の ⌘⇧O が「もう新しい会話のモード」と判定して何もしない等。E2E で起きた）。
 *
 * @param options - 操作ごとの関数と、受けない間か（{@link UseKeyboardShortcutsOptions}）
 */
export function useKeyboardShortcuts({
  handlers,
  blocked,
}: UseKeyboardShortcutsOptions): void {
  const latest = useRef({ handlers, blocked });
  useLayoutEffect(() => {
    latest.current = { handlers, blocked };
  });

  useEffect(() => {
    const isMac = readIsMac();
    const handleKeyDown = (event: KeyboardEvent) => {
      const { handlers: current, blocked: isBlocked } = latest.current;
      const id = matchShortcut(event, {
        isMac,
        inTextField: isTextField(document.activeElement),
        blocked: isBlocked || document.querySelector('dialog[open]') !== null,
      });
      const handler = id ? current[id] : undefined;
      if (!handler) return;
      event.preventDefault();
      handler();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);
}
