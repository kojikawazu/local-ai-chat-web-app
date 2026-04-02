'use client';

import { X, Bot, Palette, Wrench, BrainCircuit } from 'lucide-react';
import { type ThemeId, THEMES } from '@/hooks/useTheme';
import { AGENT_PROMPT_PRESETS } from '@/lib/agent-prompts';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  models: string[];
  selectedModel: string;
  onModelChange: (model: string) => void;
  theme: ThemeId;
  onThemeChange: (theme: ThemeId) => void;
  enableTools: boolean;
  onEnableToolsChange: (enabled: boolean) => void;
  agentPromptPresetId: string;
  onAgentPromptPresetChange: (id: string) => void;
}

export default function SettingsModal({
  isOpen,
  onClose,
  models,
  selectedModel,
  onModelChange,
  theme,
  onThemeChange,
  enableTools,
  onEnableToolsChange,
  agentPromptPresetId,
  onAgentPromptPresetChange,
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
              <Wrench size={16} className="text-nord-frost-1" />
              Agent Tools
            </label>
            <button
              onClick={() => onEnableToolsChange(!enableTools)}
              className={`flex items-center justify-between w-full px-4 py-3 rounded-lg border transition-all ${
                enableTools
                  ? 'bg-nord-frost-1/20 border-nord-frost-1'
                  : 'bg-nord-2 border-nord-3 hover:bg-nord-3'
              }`}
            >
              <div className="text-left">
                <p className="text-sm font-semibold text-nord-6">ツール使用を有効化</p>
                <p className="text-xs text-nord-4/60">
                  AIが日時取得・計算などのツールを自律的に使用します
                </p>
              </div>
              <div
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ml-4 ${
                  enableTools ? 'bg-nord-frost-1' : 'bg-nord-3'
                }`}
              >
                <div
                  className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                    enableTools ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </div>
            </button>
          </div>

          {enableTools && (
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm font-semibold text-nord-6">
                <BrainCircuit size={16} className="text-nord-frost-1" />
                Agent Prompt
              </label>
              <div className="grid gap-2">
                {AGENT_PROMPT_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => onAgentPromptPresetChange(preset.id)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all ${
                      agentPromptPresetId === preset.id
                        ? 'bg-nord-frost-1/20 border border-nord-frost-1'
                        : 'bg-nord-2 border border-nord-3 hover:bg-nord-3'
                    }`}
                  >
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-nord-6">{preset.name}</p>
                      <p className="text-xs text-nord-4/60">{preset.description}</p>
                    </div>
                    {agentPromptPresetId === preset.id && (
                      <div className="w-2 h-2 rounded-full bg-nord-frost-1 shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

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
