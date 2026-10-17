'use client';

import type { ComponentProps } from 'react';
import { useRef } from 'react';
import { X } from 'lucide-react';
import SidebarContent from './SidebarContent';
import { useDrawerDialog } from '../hooks/useDrawerDialog';

/**
 * SidebarDrawer コンポーネントの props。中身の {@link SidebarContent} の props に開閉制御を加える。
 */
type SidebarDrawerProps = Omit<
  ComponentProps<typeof SidebarContent>,
  'variant'
> & {
  /** パネル要素の id。開閉ボタンの `aria-controls` と一致させる */
  id: string;
  /** ドロワーを表示するか（false のとき何も描画しない） */
  isOpen: boolean;
  /** ドロワーを閉じるときに呼ばれる */
  onClose: () => void;
};

/**
 * モバイル幅（md 未満）でサイドバーの中身を提供する左ドロワー。
 *
 * デスクトップの {@link Sidebar} が隠れる幅でも、会話の選択・新規会話・削除・設定へ
 * 到達できるようにする（#93）。会話の選択・新規会話・設定を開く操作では閉じ、
 * 削除では続けて操作できるよう開いたままにする。背景のクリック・Escape でも閉じる。
 *
 * @param props - 開閉状態・パネル id とサイドバーの表示データ・イベントハンドラー
 */
export default function SidebarDrawer({
  id,
  isOpen,
  onClose,
  onSelectConversation,
  onNewConversation,
  onOpenSettings,
  ...contentProps
}: SidebarDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useDrawerDialog({ isOpen, onClose, containerRef: panelRef });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label="メニュー"
        tabIndex={-1}
        className="relative flex flex-col h-full w-72 max-w-[85vw] overflow-y-auto bg-nord-1 border-r border-nord-3 shadow-2xl shadow-black/40 focus:outline-none"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="メニューを閉じる"
          className="absolute top-5 right-3 p-2 rounded-lg text-nord-4/60 hover:bg-white/5 hover:text-nord-6 transition-colors"
        >
          <X size={20} />
        </button>

        <SidebarContent
          variant="drawer"
          {...contentProps}
          onSelectConversation={(conversationId) => {
            onSelectConversation(conversationId);
            onClose();
          }}
          onNewConversation={() => {
            onClose();
            onNewConversation();
          }}
          onOpenSettings={() => {
            onClose();
            onOpenSettings();
          }}
        />
      </div>
    </div>
  );
}
