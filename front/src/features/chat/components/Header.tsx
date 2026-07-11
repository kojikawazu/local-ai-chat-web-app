'use client';

import { Cpu, Activity, ChevronDown } from 'lucide-react';

/** {@link Header} の props。 */
interface HeaderProps {
  /** 選択肢として表示する利用可能モデル名の一覧。空の場合は選択中モデルのみ表示する。 */
  models: string[];
  /** 現在選択中のモデル名。 */
  selectedModel: string;
  /** モデル選択が変更されたときのコールバック。新しいモデル名を受け取る。 */
  onModelChange: (model: string) => void;
}

/**
 * アプリ上部のヘッダー。接続状態の表示とモデル選択セレクトボックスを提供する。
 *
 * モデル名の `:latest` サフィックスは表示上省略する。
 *
 * @param props - モデル一覧・選択中モデル・変更コールバックを持つ props
 */
export default function Header({
  models,
  selectedModel,
  onModelChange,
}: HeaderProps) {
  const displayName = selectedModel.replace(/:latest$/, '');

  return (
    <header className="h-16 px-6 flex items-center justify-between sticky top-0 z-10 bg-nord-1 border-b border-nord-3">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-nord-aurora-green shadow-[0_0_8px_#a3be8c]" />
          <span className="text-sm font-semibold text-nord-6">Node: Local</span>
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

      <div className="flex items-center gap-4">
        <div className="relative">
          <select
            value={selectedModel}
            onChange={(e) => onModelChange(e.target.value)}
            className="appearance-none pl-4 pr-8 py-1.5 rounded-lg text-xs font-bold border border-nord-3 bg-nord-2 text-nord-6 cursor-pointer hover:bg-nord-3 transition-colors focus:outline-none focus:ring-2 focus:ring-nord-frost-1/50"
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
