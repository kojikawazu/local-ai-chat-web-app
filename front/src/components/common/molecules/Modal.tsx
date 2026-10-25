'use client';

import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import IconButton from '@/components/common/atoms/IconButton';
import { cn } from '@/lib/shared/class-names';

/** ダイアログの幅の種類。 */
type ModalSize = 'md' | 'wide';

/** {@link Modal} の props。 */
type ModalProps = {
  /** 見出しに出すタイトル */
  title: ReactNode;
  /** ダイアログの名前（`aria-label`）。省略時はタイトルを名前にする（`aria-labelledby`） */
  label?: string;
  /** 閉じる要求（閉じるボタン・Escape・背景のクリック）で呼ぶ */
  onClose: () => void;
  /** 閉じられない間（保存中など）は true。閉じるボタンを押せなくし、Escape・背景のクリックも無視する */
  closeDisabled?: boolean;
  /** 背景のクリックで閉じるか。入力を失いやすいダイアログでは false のままにする。省略時は false */
  closeOnBackdropClick?: boolean;
  /**
   * 幅。`md` は設定・入力のダイアログ（`max-w-lg`）、`wide` は図の拡大など中身を大きく見せるもの
   * （画面いっぱいから上下左右 1rem を引いた大きさ。高さも固定）。省略時は `md`
   */
  size?: ModalSize;
  /** 本文の下に区切って出す操作（ボタン等）。省略時はフッターを出さない */
  footer?: ReactNode;
  /** 本文。高さが足りなければ本文だけをスクロールする */
  children: ReactNode;
};

const SIZE_CLASSES: Record<ModalSize, string> = {
  md: 'max-w-lg max-h-[calc(100dvh-2rem)]',
  wide: 'max-w-none h-[calc(100dvh-2rem)]',
};

/**
 * ダイアログの外枠（共通の molecule。#163）。タイトルと閉じるボタン・本文・フッターを並べる。
 *
 * 開いている間だけ描画する（呼び出し側で条件付きで置く）。ネイティブの `<dialog>` を `showModal()` で開き、
 * フォーカスの閉じ込め・背景の操作の無効化はブラウザに任せる。閉じるかは呼び出し側の状態で決めるため、
 * Escape（`cancel`）の既定動作は止めて `onClose` を呼ぶ。外したときは、開く前にフォーカスがあった要素へ戻す。
 *
 * @param props - タイトル・閉じる処理・本文・フッターを持つ props
 */
export default function Modal({
  title,
  label,
  onClose,
  closeDisabled = false,
  closeOnBackdropClick = false,
  size = 'md',
  footer,
  children,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  // 背景のクリックの判定に使う。押した位置も dialog 自身だったか（本文で選択して背景で離した場合を除く）
  const pressedOnBackdropRef = useRef(false);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      openerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      dialog.showModal();
    }
    // close() を呼ばずに外すため、ネイティブのフォーカスの戻しが効かない。代わりに戻す
    return () => {
      if (openerRef.current?.isConnected) openerRef.current.focus();
    };
  }, []);

  const requestClose = () => {
    if (!closeDisabled) onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-label={label}
      aria-labelledby={label ? undefined : titleId}
      onCancel={(e) => {
        e.preventDefault();
        requestClose();
      }}
      // cancel を止め続けると、ブラウザが cancel を出さずに閉じることがある。状態をそれに合わせる
      onClose={onClose}
      onPointerDown={(e) => {
        pressedOnBackdropRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        // 背景（::backdrop）のクリックは dialog 自身へのクリックとして届く。中身は余白なく dialog を埋める
        if (
          closeOnBackdropClick &&
          pressedOnBackdropRef.current &&
          e.target === e.currentTarget
        ) {
          requestClose();
        }
      }}
      className={cn(
        'w-[calc(100%-2rem)] m-auto p-0 open:flex flex-col rounded-2xl bg-nord-1 text-nord-6 border border-nord-3 shadow-2xl shadow-black/40 backdrop:bg-black/60',
        SIZE_CLASSES[size]
      )}
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-nord-3">
        <h2 id={titleId} className="text-lg font-bold">
          {title}
        </h2>
        <IconButton
          label="閉じる"
          size="sm"
          onClick={requestClose}
          disabled={closeDisabled}
        >
          <X size={20} />
        </IconButton>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>

      {footer && (
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-nord-3">
          {footer}
        </div>
      )}
    </dialog>
  );
}
