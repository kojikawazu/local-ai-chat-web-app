'use client';

import { Cpu, Activity, ChevronDown, Menu, UserRoundCog } from 'lucide-react';

/** {@link Header} の props。 */
type HeaderProps = {
  /** 選択肢として表示する利用可能モデル名の一覧。空の場合は選択中モデルのみ表示する。 */
  models: string[];
  /** 現在選択中のモデル名。 */
  selectedModel: string;
  /** モデル選択が変更されたときのコールバック。新しいモデル名を受け取る。 */
  onModelChange: (model: string) => void;
  /** メニュー（モバイル用サイドバードロワー）のパネル id。メニューボタンの `aria-controls` に使う。 */
  menuId: string;
  /** メニューが開いているか。メニューボタンの `aria-expanded` に反映する。 */
  isMenuOpen: boolean;
  /** メニューボタン押下時のコールバック。 */
  onOpenMenu: () => void;
  /** 現在の会話の役割の表示名（「翻訳者」「カスタム」「役割なし」等。#10）。 */
  roleLabel: string;
  /** 役割ボタン押下時のコールバック（役割の編集ダイアログを開く）。 */
  onOpenRole: () => void;
};

/**
 * アプリ上部のヘッダー。接続状態の表示・会話の役割の表示と編集の入口・モデル選択セレクトボックスを提供する。
 *
 * モバイル幅（md 未満）ではサイドバーが隠れるため、先頭にメニューボタンを出し、
 * 会話管理・設定を持つドロワーを開けるようにする。
 * モデル名の `:latest` サフィックスは表示上省略する。役割の名前はモバイル幅では隠し、
 * アイコンだけを出す（ボタン名で読み上げる）。
 * 幅が足りないときに縮むのはモデル選択だけにする（左側は縮めず、モデル名を省略表示する）。
 * 左側も縮めると `whitespace-nowrap` の「Node: Local」が隣の役割ボタンに重なり、
 * 幅指定の無い select は縮んだ親からはみ出すため。
 *
 * @param props - モデル一覧・選択中モデル・変更コールバック・メニューの開閉状態・役割の表示名と編集の入口を持つ props
 */
export default function Header({
  models,
  selectedModel,
  onModelChange,
  menuId,
  isMenuOpen,
  onOpenMenu,
  roleLabel,
  onOpenRole,
}: HeaderProps) {
  const displayName = selectedModel.replace(/:latest$/, '');

  return (
    <header className="h-16 px-4 md:px-6 flex items-center justify-between gap-3 sticky top-0 z-10 bg-nord-1 border-b border-nord-3">
      <div className="flex items-center gap-3 md:gap-6 shrink-0">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="メニューを開く"
          aria-haspopup="dialog"
          aria-expanded={isMenuOpen}
          aria-controls={menuId}
          className="md:hidden -ml-2 p-2 rounded-lg text-nord-4 hover:bg-white/5 transition-colors"
        >
          <Menu size={22} />
        </button>

        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2.5 h-2.5 shrink-0 rounded-full bg-nord-aurora-green shadow-[0_0_8px_#a3be8c]" />
          <span className="text-sm font-semibold text-nord-6 whitespace-nowrap">
            Node: Local
          </span>
        </div>

        <div className="hidden md:flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-xs text-nord-4/60">
            <Cpu size={14} />
            <span>Ollama</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-nord-4/60">
            <Activity size={14} />
            <span>Active</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 md:gap-4 min-w-0">
        <button
          type="button"
          onClick={onOpenRole}
          aria-label={`会話の役割: ${roleLabel}`}
          aria-haspopup="dialog"
          className="flex items-center gap-1.5 shrink-0 px-2 md:px-3 py-1.5 rounded-lg text-xs font-bold border border-nord-3 bg-nord-2 text-nord-4 hover:bg-nord-3 hover:text-nord-6 transition-colors focus:outline-none focus:ring-2 focus:ring-nord-frost-1/50"
        >
          <UserRoundCog size={14} className="text-nord-frost-1" />
          <span className="hidden md:inline max-w-32 truncate">
            {roleLabel}
          </span>
        </button>
        <div className="relative min-w-0">
          <select
            value={selectedModel}
            onChange={(e) => onModelChange(e.target.value)}
            aria-label="モデルを選択"
            className="w-full max-w-36 md:max-w-none truncate appearance-none pl-4 pr-8 py-1.5 rounded-lg text-xs font-bold border border-nord-3 bg-nord-2 text-nord-6 cursor-pointer hover:bg-nord-3 transition-colors focus:outline-none focus:ring-2 focus:ring-nord-frost-1/50"
          >
            {models.length > 0 ? (
              models.map((model) => (
                <option key={model} value={model}>
                  {model.replace(/:latest$/, '')}
                </option>
              ))
            ) : (
              <option value={selectedModel}>{displayName}</option>
            )}
          </select>
          <ChevronDown
            size={14}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-nord-4/60 pointer-events-none"
          />
        </div>
      </div>
    </header>
  );
}
