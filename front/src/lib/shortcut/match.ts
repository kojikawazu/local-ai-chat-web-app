import { SHORTCUTS } from '@/constants/shortcut/shortcuts';
import type { ShortcutBinding, ShortcutId } from '@/types/shortcut/shortcut';

/**
 * ページ全体のショートカット（#33。`docs/23-keyboard-shortcuts.md`）のキーの判定と、ヘルプのキーの表記を行う純関数群。
 *
 * DOM に依存させない（押されたキーと、そのときの状況を引数で受ける）。
 */

/** 判定に使う、押されたキーの情報（`KeyboardEvent` の一部）。 */
export type ShortcutKeyInput = {
  /** `KeyboardEvent.key` */
  key: string;
  /** ⌘（Mac）・Windows キー */
  metaKey: boolean;
  /** Ctrl */
  ctrlKey: boolean;
  /** Alt・⌥ */
  altKey: boolean;
  /** Shift */
  shiftKey: boolean;
  /** IME の変換中か */
  isComposing: boolean;
  /** 押しっぱなしの繰り返しか */
  repeat: boolean;
  /** ほかの部品がもう処理したか（入力欄のテンプレートの候補の ↑↓ 等） */
  defaultPrevented: boolean;
};

/** 判定のときの状況。 */
export type ShortcutContext = {
  /** Mac か（`mod` を ⌘ と読むか Ctrl と読むか） */
  isMac: boolean;
  /** フォーカスが入力欄・テキストの欄にあるか */
  inTextField: boolean;
  /** モーダル・ドロワーが開いているか（開いている間はショートカットを受けない） */
  blocked: boolean;
};

/**
 * プラットフォームの名前が Mac かを判定する。
 *
 * @param platform - `navigator.userAgentData.platform`・`navigator.platform` の値（`MacIntel`・`macOS` 等）
 * @returns Mac（iPhone・iPad を含む Apple の端末）なら true
 */
export function isMacPlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/**
 * 押されたキーが 1 つのキーの組み合わせにちょうど一致するかを判定する。
 *
 * 修飾キーは、書いたものと押したものがちょうど一致するときだけ受ける（⌘K のつもりで ⌘⇧K を押しても受けない）。
 * `mod` は Mac では ⌘、それ以外では Ctrl と読む。英字は大文字・小文字を区別しない（Shift で `O` になるため）。
 *
 * @param input - 押されたキー
 * @param binding - キーの組み合わせ
 * @param isMac - Mac か
 * @returns ちょうど一致すれば true
 */
function matchesBinding(
  input: ShortcutKeyInput,
  binding: ShortcutBinding,
  isMac: boolean
): boolean {
  if (input.key.toLowerCase() !== binding.key.toLowerCase()) return false;
  const wantMeta = isMac && binding.mod === true;
  const wantCtrl = (!isMac && binding.mod === true) || binding.ctrl === true;
  if (input.metaKey !== wantMeta || input.ctrlKey !== wantCtrl) return false;
  if (input.altKey) return false;
  return (
    binding.anyShift === true || input.shiftKey === (binding.shift === true)
  );
}

/**
 * 押されたキーに当たるショートカットを探す。
 *
 * 次のときは受けない（`null`）: IME の変換中・モーダルやドロワーが開いている・ほかの部品がもう処理した・
 * 押しっぱなし（会話の切り替えだけは受ける）・入力欄の中で、入力欄では受けないキー（`?`）を押した。
 *
 * @param input - 押されたキー
 * @param context - そのときの状況（Mac か・入力欄の中か・モーダルが開いているか）
 * @returns 当たったショートカットの操作。当たらなければ `null`
 */
export function matchShortcut(
  input: ShortcutKeyInput,
  context: ShortcutContext
): ShortcutId | null {
  if (input.isComposing || context.blocked || input.defaultPrevented) {
    return null;
  }
  for (const shortcut of SHORTCUTS) {
    if (input.repeat && !shortcut.repeatable) continue;
    const hit = shortcut.bindings.some(
      (binding) =>
        (binding.inTextField || !context.inTextField) &&
        matchesBinding(input, binding, context.isMac)
    );
    if (hit) return shortcut.id;
  }
  return null;
}

// ヘルプに出す、キーの名前の表記（英字以外）
const KEY_LABELS: Record<string, string> = {
  Escape: 'Esc',
  ArrowUp: '↑',
  ArrowDown: '↓',
};

/**
 * ヘルプに出すために、キーの組み合わせを押す順のキーの名前に分ける。
 *
 * Mac は ⌃ ⇧ ⌘ の記号、それ以外は Ctrl・Shift の名前で出す（開いている端末の表記だけを出す）。
 * 修飾キーの順は Mac の慣習（⌃ ⇧ ⌘）、それ以外は Ctrl → Shift。`anyShift` のキーには Shift を出さない。
 *
 * @param binding - キーの組み合わせ
 * @param isMac - Mac か
 * @returns 押すキーの名前（例: `['⇧', '⌘', 'O']`・`['Ctrl', 'Shift', 'O']`）
 */
export function formatBinding(
  binding: ShortcutBinding,
  isMac: boolean
): string[] {
  const keyLabel =
    KEY_LABELS[binding.key] ??
    (binding.key.length === 1 ? binding.key.toUpperCase() : binding.key);
  const ctrl = binding.ctrl === true || (!isMac && binding.mod === true);
  const shift = binding.shift === true && binding.anyShift !== true;
  const meta = isMac && binding.mod === true;
  if (isMac) {
    return [
      ...(ctrl ? ['⌃'] : []),
      ...(shift ? ['⇧'] : []),
      ...(meta ? ['⌘'] : []),
      keyLabel,
    ];
  }
  return [...(ctrl ? ['Ctrl'] : []), ...(shift ? ['Shift'] : []), keyLabel];
}
