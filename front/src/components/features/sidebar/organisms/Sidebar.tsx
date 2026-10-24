'use client';

import type { ComponentProps } from 'react';
import SidebarContent from './SidebarContent';

/**
 * Sidebar コンポーネントの props。中身の {@link SidebarContent} と同じで、表示先だけを固定する。
 */
type SidebarProps = Omit<ComponentProps<typeof SidebarContent>, 'variant'>;

/**
 * 会話履歴・新規会話ボタン・設定ボタンを表示する左サイドバー。
 *
 * デスクトップ幅（md 以上）でのみ表示される。md 未満では同じ中身を
 * {@link SidebarDrawer}（ヘッダーのメニューボタンから開く）で提供する。
 *
 * @param props - サイドバーの表示データとイベントハンドラー
 */
export default function Sidebar(props: SidebarProps) {
  return (
    <aside className="hidden md:flex w-72 flex-col h-full bg-nord-1 border-r border-nord-3">
      <SidebarContent variant="desktop" {...props} />
    </aside>
  );
}
