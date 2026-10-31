import { describe, it, expect } from 'vitest';
import type { ShortcutContext, ShortcutKeyInput } from '@/lib/shortcut/match';
import {
  formatBinding,
  isMacPlatform,
  matchShortcut,
} from '@/lib/shortcut/match';
import {
  adjacentConversationId,
  isListNavigationKey,
  nextListIndex,
} from '@/lib/sidebar/list-navigation';
import { SHORTCUTS } from '@/constants/shortcut/shortcuts';

/**
 * ショートカットキー（#33）の純ロジックの UT。外部 I/O が無いため mock は使わない。
 * 対象: キーの判定（`matchShortcut`）・端末の判定と表記（`isMacPlatform`・`formatBinding`）・
 * 一覧の移る先（`nextListIndex`・`adjacentConversationId`・`isListNavigationKey`）。
 */

/**
 * 押されたキーを作る（既定は修飾キーなし・IME なし・繰り返しなし）。
 *
 * @param key - `KeyboardEvent.key`
 * @param overrides - 変える項目
 * @returns 押されたキー
 */
const press = (
  key: string,
  overrides: Partial<ShortcutKeyInput> = {}
): ShortcutKeyInput => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  repeat: false,
  defaultPrevented: false,
  ...overrides,
});

/** Mac・入力欄の外・モーダルなし */
const MAC: ShortcutContext = {
  isMac: true,
  inTextField: false,
  blocked: false,
};
/** Windows / Linux・入力欄の外・モーダルなし */
const PC: ShortcutContext = {
  isMac: false,
  inTextField: false,
  blocked: false,
};

describe('matchShortcut', () => {
  describe('正常系', () => {
    it('Mac は ⌘、それ以外は Ctrl を mod として読む', () => {
      expect(matchShortcut(press('k', { metaKey: true }), MAC)).toBe(
        'searchConversations'
      );
      expect(matchShortcut(press('k', { ctrlKey: true }), PC)).toBe(
        'searchConversations'
      );
      expect(matchShortcut(press('b', { metaKey: true }), MAC)).toBe(
        'toggleSidebar'
      );
    });

    it('Shift で大文字になった英字も受ける（⌘⇧O）', () => {
      expect(
        matchShortcut(press('O', { metaKey: true, shiftKey: true }), MAC)
      ).toBe('newConversation');
      expect(
        matchShortcut(press('o', { ctrlKey: true, shiftKey: true }), PC)
      ).toBe('newConversation');
    });

    it('前・次の会話は Mac でも Ctrl+Shift+↑↓', () => {
      expect(
        matchShortcut(press('ArrowUp', { ctrlKey: true, shiftKey: true }), MAC)
      ).toBe('previousConversation');
      expect(
        matchShortcut(press('ArrowDown', { ctrlKey: true, shiftKey: true }), PC)
      ).toBe('nextConversation');
    });

    it('Shift+Escape・⌘/・? を受ける', () => {
      expect(matchShortcut(press('Escape', { shiftKey: true }), MAC)).toBe(
        'focusInput'
      );
      expect(matchShortcut(press('/', { metaKey: true }), MAC)).toBe(
        'showHelp'
      );
      // ? は配列によって Shift の有無が変わるため、Shift を見ない
      expect(matchShortcut(press('?', { shiftKey: true }), PC)).toBe(
        'showHelp'
      );
      expect(matchShortcut(press('?'), PC)).toBe('showHelp');
    });

    it('修飾キー付きのものは入力欄の中でも受ける', () => {
      const inText = { ...MAC, inTextField: true };
      expect(matchShortcut(press('k', { metaKey: true }), inText)).toBe(
        'searchConversations'
      );
      expect(matchShortcut(press('Escape', { shiftKey: true }), inText)).toBe(
        'focusInput'
      );
      expect(matchShortcut(press('/', { metaKey: true }), inText)).toBe(
        'showHelp'
      );
    });

    it('前・次の会話は押しっぱなしでも受ける', () => {
      expect(
        matchShortcut(
          press('ArrowDown', { ctrlKey: true, shiftKey: true, repeat: true }),
          MAC
        )
      ).toBe('nextConversation');
    });
  });

  describe('準正常系', () => {
    it('修飾キーがちょうど一致しなければ受けない（⌘⇧K・⌘⌥K を ⌘K と見ない）', () => {
      expect(
        matchShortcut(press('k', { metaKey: true, shiftKey: true }), MAC)
      ).toBeNull();
      expect(
        matchShortcut(press('k', { metaKey: true, altKey: true }), MAC)
      ).toBeNull();
      // ⌘O（Shift なし）は新しい会話ではない
      expect(matchShortcut(press('o', { metaKey: true }), MAC)).toBeNull();
    });

    it('端末の mod と違う修飾キーは受けない（Mac の Ctrl+K・PC の Meta+K）', () => {
      expect(matchShortcut(press('k', { ctrlKey: true }), MAC)).toBeNull();
      expect(matchShortcut(press('k', { metaKey: true }), PC)).toBeNull();
      // 前・次の会話は Mac でも ⌘ ではない
      expect(
        matchShortcut(press('ArrowUp', { metaKey: true, shiftKey: true }), MAC)
      ).toBeNull();
    });

    it('入力欄の中の ? は文字として打たせる（受けない）', () => {
      expect(
        matchShortcut(press('?'), { ...PC, inTextField: true })
      ).toBeNull();
    });

    it('修飾キーの無い文字・Escape だけは受けない', () => {
      expect(matchShortcut(press('k'), MAC)).toBeNull();
      expect(matchShortcut(press('Escape'), MAC)).toBeNull();
    });

    it('押しっぱなしは会話の切り替え以外では受けない', () => {
      expect(
        matchShortcut(press('b', { metaKey: true, repeat: true }), MAC)
      ).toBeNull();
    });
  });

  describe('異常系', () => {
    it('IME の変換中・モーダルやドロワーが開いている間・処理済みのキーは受けない', () => {
      expect(
        matchShortcut(press('k', { metaKey: true, isComposing: true }), MAC)
      ).toBeNull();
      expect(
        matchShortcut(press('k', { metaKey: true }), { ...MAC, blocked: true })
      ).toBeNull();
      expect(
        matchShortcut(
          press('ArrowDown', {
            ctrlKey: true,
            shiftKey: true,
            defaultPrevented: true,
          }),
          MAC
        )
      ).toBeNull();
    });

    it('知らないキーは受けない', () => {
      expect(matchShortcut(press('Unidentified'), MAC)).toBeNull();
      expect(matchShortcut(press(''), PC)).toBeNull();
    });
  });
});

describe('isMacPlatform・formatBinding', () => {
  const byId = (id: string) => {
    const shortcut = SHORTCUTS.find((s) => s.id === id);
    if (!shortcut) throw new Error(`定義が無い: ${id}`);
    return shortcut.bindings;
  };

  describe('正常系', () => {
    it('Mac の名前を判定する', () => {
      expect(isMacPlatform('MacIntel')).toBe(true);
      expect(isMacPlatform('macOS')).toBe(true);
      expect(isMacPlatform('iPhone')).toBe(true);
      expect(isMacPlatform('Win32')).toBe(false);
      expect(isMacPlatform('Linux x86_64')).toBe(false);
    });

    it('Mac は ⌃ ⇧ ⌘ の記号、それ以外は Ctrl・Shift で出す', () => {
      const [newConversation] = byId('newConversation');
      expect(formatBinding(newConversation, true)).toEqual(['⇧', '⌘', 'O']);
      expect(formatBinding(newConversation, false)).toEqual([
        'Ctrl',
        'Shift',
        'O',
      ]);
      const [previous] = byId('previousConversation');
      expect(formatBinding(previous, true)).toEqual(['⌃', '⇧', '↑']);
      expect(formatBinding(previous, false)).toEqual(['Ctrl', 'Shift', '↑']);
    });
  });

  describe('準正常系', () => {
    it('Escape は Esc と出し、? には Shift を出さない', () => {
      const [focusInput] = byId('focusInput');
      expect(formatBinding(focusInput, true)).toEqual(['⇧', 'Esc']);
      const [, question] = byId('showHelp');
      expect(formatBinding(question, false)).toEqual(['?']);
    });
  });

  describe('異常系', () => {
    it('空のプラットフォーム名は Mac ではない（Ctrl の表記に倒す）', () => {
      expect(isMacPlatform('')).toBe(false);
    });
  });
});

describe('一覧の移る先', () => {
  describe('正常系', () => {
    it('↑↓ で前・次、Home・End で最初・最後へ', () => {
      expect(nextListIndex(1, 'ArrowDown', 3)).toBe(2);
      expect(nextListIndex(1, 'ArrowUp', 3)).toBe(0);
      expect(nextListIndex(1, 'Home', 3)).toBe(0);
      expect(nextListIndex(1, 'End', 3)).toBe(2);
    });

    it('前・次の会話は、サイドバーの並びの上・下の会話', () => {
      const ids = ['a', 'b', 'c'];
      expect(adjacentConversationId(ids, 'b', 'previous')).toBe('a');
      expect(adjacentConversationId(ids, 'b', 'next')).toBe('c');
    });

    it('移るキーを判定する', () => {
      expect(isListNavigationKey('ArrowDown')).toBe(true);
      expect(isListNavigationKey('End')).toBe(true);
      expect(isListNavigationKey('Enter')).toBe(false);
    });
  });

  describe('準正常系', () => {
    it('端では止まる（回らない）', () => {
      expect(nextListIndex(0, 'ArrowUp', 3)).toBeNull();
      expect(nextListIndex(2, 'ArrowDown', 3)).toBeNull();
      expect(nextListIndex(0, 'Home', 3)).toBeNull();
      expect(adjacentConversationId(['a', 'b'], 'a', 'previous')).toBeNull();
      expect(adjacentConversationId(['a', 'b'], 'b', 'next')).toBeNull();
    });

    it('開いている会話が一覧に無いとき、次は一番上・前は無し', () => {
      expect(adjacentConversationId(['a', 'b'], null, 'next')).toBe('a');
      expect(adjacentConversationId(['a', 'b'], null, 'previous')).toBeNull();
      // 作った直後で一覧の読み直しの前
      expect(adjacentConversationId(['a', 'b'], 'new', 'next')).toBe('a');
    });
  });

  describe('異常系', () => {
    it('空の一覧では動かない', () => {
      expect(nextListIndex(0, 'ArrowDown', 0)).toBeNull();
      expect(adjacentConversationId([], null, 'next')).toBeNull();
      expect(adjacentConversationId([], 'a', 'previous')).toBeNull();
    });
  });
});
