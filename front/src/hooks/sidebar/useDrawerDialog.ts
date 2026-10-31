import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';
import { DESKTOP_MEDIA_QUERY } from '@/constants/sidebar/layout';

// フォーカストラップの循環対象。無効化された要素と tabindex="-1"（プログラムからのみフォーカス）は除く
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * {@link useDrawerDialog} の引数。
 */
type UseDrawerDialogOptions = {
  /** ドロワーが開いているか。true の間だけ各挙動を有効にする */
  isOpen: boolean;
  /** 閉じる要求（Escape・デスクトップ幅への拡大）で呼ばれる */
  onClose: () => void;
  /** ドロワーのパネル要素。フォーカスの移動先・トラップの範囲になる */
  containerRef: RefObject<HTMLElement | null>;
};

/**
 * モーダルなドロワーのキーボード操作・フォーカス・スクロールを管理する。
 *
 * 開いている間は次を行う:
 * - 開いた直後にパネル内の先頭の操作要素へフォーカスを移す（無ければパネル自体）
 * - Tab / Shift+Tab のフォーカスをパネル内で循環させる（背景へ抜けない）
 * - Escape で閉じる
 * - `body` のスクロールを止める（背景が動かない）
 * - デスクトップ幅へ広がったら閉じる
 *
 * 閉じたら、開く前にフォーカスしていた要素（メニューボタン）へフォーカスを戻す。
 *
 * @param options - 開閉状態・閉じるコールバック・パネル要素の ref
 */
export function useDrawerDialog({
  isOpen,
  onClose,
  containerRef,
}: UseDrawerDialogOptions): void {
  // onClose は親の再描画ごとに作り直され得る。依存に入れると開いたまま effect が
  // 張り直され、フォーカスの初期化と復元が走ってしまうため、最新値は ref で参照する
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!isOpen) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const getFocusable = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

    (getFocusable()[0] ?? container).focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;

      const focusable = getFocusable();
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const outside = !container.contains(active);
      if (e.shiftKey && (active === first || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    // ドロワーは md:hidden で消えるため、デスクトップの幅に広がったら state 上も閉じ、body のスクロール固定を残さない
    const desktopQuery = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const handleMediaChange = (e: MediaQueryListEvent) => {
      if (e.matches) onCloseRef.current();
    };
    desktopQuery.addEventListener('change', handleMediaChange);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      desktopQuery.removeEventListener('change', handleMediaChange);
      document.body.style.overflow = previousOverflow;
      // パネルが DOM から外れるとフォーカスは body に落ちるため、開く前の要素へ戻す。
      // 閉じる操作の後で別の要素へ移す処理（新規会話 → 入力欄）は、この後に走って上書きする
      const active = document.activeElement;
      if (!active || active === document.body || container.contains(active)) {
        previouslyFocused?.focus();
      }
    };
  }, [isOpen, containerRef]);
}
