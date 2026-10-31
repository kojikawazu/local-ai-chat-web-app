'use client';

import { Fragment } from 'react';
import Modal from '@/components/common/molecules/Modal';
import { SHORTCUTS } from '@/constants/shortcut/shortcuts';
import { useIsMac } from '@/hooks/shortcut/useIsMac';
import { formatBinding } from '@/lib/shortcut/match';

/** {@link ShortcutHelpDialog} の props。 */
type ShortcutHelpDialogProps = {
  /** 閉じる要求（閉じるボタン・Escape・背景のクリック）で呼ぶ */
  onClose: () => void;
};

/** サイドバーの一覧の中だけで効くキー（ページ全体のショートカットの定義には無いため、ここで書く） */
const LIST_KEYS = [
  { label: '一覧の前・次の会話へ', keys: [['↑'], ['↓']] },
  { label: '一覧の最初・最後の会話へ', keys: [['Home'], ['End']] },
];

/**
 * ショートカットの一覧のダイアログ（#33。`docs/23-keyboard-shortcuts.md`「ヘルプ」）。
 *
 * 中身はショートカットの定義（`SHORTCUTS`）から作り、キーは開いている端末の表記（Mac は ⌘ ⇧ ⌃、それ以外は Ctrl・Shift）で
 * `<kbd>` に出す。1 つの操作に複数のキーがあるときは「または」で並べる。サイドバーの一覧の中だけで効くキーは、表の下に分けて出す。
 *
 * @param props - 閉じる処理
 */
export default function ShortcutHelpDialog({
  onClose,
}: ShortcutHelpDialogProps) {
  const isMac = useIsMac();
  const rows = SHORTCUTS.map((shortcut) => ({
    label: shortcut.label,
    keys: shortcut.bindings.map((binding) => formatBinding(binding, isMac)),
  }));

  return (
    <Modal
      title="Keyboard Shortcuts"
      label="キーボードショートカット"
      onClose={onClose}
      closeOnBackdropClick
    >
      <div className="space-y-6">
        <ShortcutTable caption="どこでも" rows={rows} />
        <ShortcutTable
          caption="サイドバーの会話の一覧で（行にフォーカスがあるとき）"
          rows={LIST_KEYS}
        />
        <p className="text-xs text-nord-4/60">
          IME
          の変換中と、ほかのダイアログ・メニューが開いている間は効きません。「?」は入力欄の外で押したときだけ効きます。
        </p>
      </div>
    </Modal>
  );
}

/** {@link ShortcutTable} の props。 */
type ShortcutTableProps = {
  /** 表の見出し（読み上げにも使う） */
  caption: string;
  /** 行（説明と、キーの組み合わせの一覧。組み合わせは押すキーの名前の並び） */
  rows: { label: string; keys: string[][] }[];
};

/**
 * ショートカットの表（説明とキー）。
 *
 * @param props - 見出しと行
 */
function ShortcutTable({ caption, rows }: ShortcutTableProps) {
  return (
    <table className="w-full text-sm">
      <caption className="mb-2 text-left text-xs font-semibold uppercase tracking-wider text-nord-4/60">
        {caption}
      </caption>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="border-t border-nord-3">
            <th
              scope="row"
              className="py-2 pr-4 text-left font-normal text-nord-6"
            >
              {row.label}
            </th>
            <td className="py-2 text-right">
              {row.keys.map((combo, i) => (
                <Fragment key={combo.join('+')}>
                  {i > 0 && (
                    <span className="mx-1.5 text-xs text-nord-4/60">
                      または
                    </span>
                  )}
                  <span className="inline-flex gap-1">
                    {combo.map((key) => (
                      <kbd
                        key={key}
                        className="min-w-6 rounded border border-nord-3 bg-nord-2 px-1.5 py-0.5 text-center font-mono text-xs text-nord-6"
                      >
                        {key}
                      </kbd>
                    ))}
                  </span>
                </Fragment>
              ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
