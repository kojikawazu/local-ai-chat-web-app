/**
 * ページ全体のショートカットの操作（#33。`docs/23-keyboard-shortcuts.md`）。
 *
 * 定義（`constants/shortcut/shortcuts.ts`）・判定（`lib/shortcut/match.ts`）・ページの操作の対応表で使う。
 */
export type ShortcutId =
  | 'newConversation'
  | 'searchConversations'
  | 'toggleSidebar'
  | 'focusInput'
  | 'previousConversation'
  | 'nextConversation'
  | 'showHelp';

/**
 * ショートカットの 1 つのキーの組み合わせ。修飾キーは書いたものと押したものがちょうど一致するときだけ受ける。
 */
export type ShortcutBinding = {
  /** `KeyboardEvent.key` の値。英字は小文字で書く（大文字・小文字の両方を受ける） */
  key: string;
  /** Mac では ⌘（`metaKey`）、それ以外では Ctrl（`ctrlKey`）を押す */
  mod?: boolean;
  /** どの端末でも Ctrl を押す（Mac で ⌘ と区別したいキー） */
  ctrl?: boolean;
  /** Shift を押す */
  shift?: boolean;
  /**
   * Shift の有無を見ない。`?` のように、配列によって Shift を押して打つかが変わる文字に使う
   */
  anyShift?: boolean;
  /** 入力欄・テキストの欄にフォーカスがあるときも受けるか（修飾キーの無い文字は false にして、文字として打たせる） */
  inTextField: boolean;
};

/** ショートカットの定義（ヘルプの 1 行と、判定のキー）。 */
export type ShortcutDefinition = {
  /** 操作 */
  id: ShortcutId;
  /** ヘルプに出す説明 */
  label: string;
  /** 受けるキーの組み合わせ（どれか 1 つで操作する。ヘルプには「または」で並べる） */
  bindings: ShortcutBinding[];
  /** 押しっぱなし（`repeat`）でも続けて受けるか。会話の切り替えだけ true */
  repeatable?: boolean;
};
