import type { ShortcutDefinition } from '@/types/shortcut/shortcut';

/**
 * ページ全体のショートカットの定義（#33。`docs/23-keyboard-shortcuts.md`「ショートカットの一覧」）。
 *
 * 判定（`lib/shortcut/match.ts`）とヘルプ（`ShortcutHelpDialog`）の両方がこれを読む。キーを変えるときはここだけを直す。
 * 並び順はヘルプの表の順。型（`ShortcutDefinition`）で形を決めているため `as const` は付けない（付けると `bindings` が読み取り専用の
 * タプルになり、型の配列に入らない）。
 *
 * - 新しい会話は ⌘N・Ctrl+N にしない（ブラウザが新しいウィンドウに使い、ページから止められない）
 * - 前・次の会話は Mac でも Ctrl（⌘⇧↑↓ は Mac の入力欄で先頭・末尾まで選ぶのに使われる）
 * - `?` だけは修飾キーが無いので、入力欄の外でしか受けない（入力欄では文字として打つ）
 */
export const SHORTCUTS: readonly ShortcutDefinition[] = [
  {
    id: 'newConversation',
    label: '新しい会話',
    bindings: [{ key: 'o', mod: true, shift: true, inTextField: true }],
  },
  {
    id: 'searchConversations',
    label: '会話を検索',
    bindings: [{ key: 'k', mod: true, inTextField: true }],
  },
  {
    id: 'toggleSidebar',
    label: 'サイドバーを開く・閉じる',
    bindings: [{ key: 'b', mod: true, inTextField: true }],
  },
  {
    id: 'focusInput',
    label: '入力欄にフォーカス',
    bindings: [{ key: 'Escape', shift: true, inTextField: true }],
  },
  {
    id: 'previousConversation',
    label: '前の会話',
    bindings: [{ key: 'ArrowUp', ctrl: true, shift: true, inTextField: true }],
    repeatable: true,
  },
  {
    id: 'nextConversation',
    label: '次の会話',
    bindings: [
      { key: 'ArrowDown', ctrl: true, shift: true, inTextField: true },
    ],
    repeatable: true,
  },
  {
    id: 'showHelp',
    label: 'ショートカットの一覧',
    bindings: [
      { key: '/', mod: true, inTextField: true },
      { key: '?', anyShift: true, inTextField: false },
    ],
  },
];
