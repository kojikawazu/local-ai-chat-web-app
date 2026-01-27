'use client';

import { X, Bot, Palette } from 'lucide-react';
import { type ThemeId, THEMES } from '@/hooks/useTheme';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  models: string[];
  selectedModel: string;
  onModelChange: (model: string) => void;
  theme: ThemeId;
  onThemeChange: (theme: ThemeId) => void;
}

export default function SettingsModal({
  isOpen,
  onClose,
  models,
  selectedModel,
  onModelChange,
  theme,
  onThemeChange,
}: SettingsModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="設定"
    >
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />

      <div className="relative w-full max-w-lg mx-4 rounded-2xl bg-nord-1 border border-nord-3 shadow-2xl shadow-black/40">
        <div className="flex items-center justify-between p-6 border-b border-nord-3">
          <h2 className="text-lg font-bold text-nord-6">Settings</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-nord-4/60 hover:bg-white/5 hover:text-nord-6 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-nord-6">
              <Bot size={16} className="text-nord-frost-1" />
              Model
            </label>
            <select
              value={selectedModel}
              onChange={(e) => onModelChange(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg text-sm border border-nord-3 bg-nord-2 text-nord-6 focus:outline-none focus:ring-2 focus:ring-nord-frost-1/50"
            >
              {models.length > 0 ? (
                models.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))
              ) : (
                <option value={selectedModel}>{selectedModel}</option>
              )}
            </select>
            <p className="text-xs text-nord-4/60">
              Ollamaで利用可能なモデルを選択します
            </p>
          </div>

          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-nord-6">
              <Palette size={16} className="text-nord-frost-1" />
              Theme
            </label>
            <div className="grid gap-2">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onThemeChange(t.id)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all ${
                    theme === t.id
                      ? 'bg-nord-frost-1/20 border border-nord-frost-1'
                      : 'bg-nord-2 border border-nord-3 hover:bg-nord-3'
                  }`}
                >
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-nord-6">
                      {t.name}
                    </p>
                    <p className="text-xs text-nord-4/60">{t.description}</p>
                  </div>
                  {theme === t.id && (
                    <div className="w-2 h-2 rounded-full bg-nord-frost-1" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end p-6 border-t border-nord-3">
          <button
            onClick={onClose}
            className="px-6 py-2 rounded-lg text-sm font-bold bg-nord-frost-1 text-nord-0 hover:bg-nord-frost-2 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
