'use client';

import type { ComponentProps } from 'react';
import { cn } from '@/lib/shared/class-names';
import SidebarContent from './SidebarContent';

/**
 * Sidebar コンポーネントの props。中身の {@link SidebarContent} と同じで、表示先だけを固定する。
 */
type SidebarProps = Omit<ComponentProps<typeof SidebarContent>, 'variant'> & {
  /** 要素の id。ヘッダーの切り替えボタンの `aria-controls` に使う */
  id: string;
  /** 表示するか。`false` なら幅を 0 にし、中身を操作・読み上げの対象から外す（#24） */
  isOpen: boolean;
  /** 幅の変化をアニメーションで見せるか。保存値を読み終えるまでは `false`（開き直したときに閉じる動きを見せない） */
  animate: boolean;
};

/**
 * 会話履歴・新規会話ボタン・設定ボタンを表示する左サイドバー。
 *
 * デスクトップ幅（md 以上）でのみ表示される。md 未満では同じ中身を
 * {@link SidebarDrawer}（ヘッダーのメニューボタンから開く）で提供する。
 * ヘッダーの切り替えボタンで隠せる（#24）。隠すときは幅を 0 にし、中身は幅を固定したまま
 * はみ出させて切る（幅の変化の途中で中身が折り返さないように）。隠している間は `inert` で
 * Tab・読み上げの対象から外す。
 *
 * @param props - 表示するか・サイドバーの表示データとイベントハンドラー
 */
export default function Sidebar({
  id,
  isOpen,
  animate,
  ...props
}: SidebarProps) {
  return (
    <aside
      id={id}
      inert={!isOpen}
      className={cn(
        'hidden md:flex shrink-0 h-full overflow-hidden bg-nord-1 border-nord-3',
        isOpen ? 'w-72 border-r' : 'w-0',
        animate &&
          'transition-[width] duration-200 ease-out motion-reduce:transition-none'
      )}
    >
      <div className="w-72 shrink-0 flex flex-col h-full">
        <SidebarContent variant="desktop" {...props} />
      </div>
    </aside>
  );
}
