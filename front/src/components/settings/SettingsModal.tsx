'use client';

import { X, Bot, Palette, Wrench, BrainCircuit } from 'lucide-react';
import type { ThemeId } from '@/types/theme/theme';
import { THEMES } from '@/types/theme/theme';
import { AGENT_PROMPT_PRESETS } from '@/lib/agent/agent-prompts';
import Button from '@/components/common/atoms/Button';
import IconButton from '@/components/common/atoms/IconButton';
import Select from '@/components/common/atoms/Select';
import StatusDot from '@/components/common/atoms/StatusDot';
import Switch from '@/components/common/atoms/Switch';

/**
 * SettingsModal コンポーネントの props。
 */
interface SettingsModalProps {
  /** モーダルを表示するかどうか（false のとき何も描画しない） */
  isOpen: boolean;
  /** モーダルを閉じるときに呼ばれる */
  onClose: () => void;
  /** 選択肢として表示する利用可能モデル名の一覧 */
  models: string[];
  /** 現在選択中のモデル名 */
  selectedModel: string;
  /** モデル選択が変わったときに呼ばれる。引数は選択されたモデル名 */
  onModelChange: (model: string) => void;
  /** 現在選択中のテーマ ID */
  theme: ThemeId;
  /** テーマ選択が変わったときに呼ばれる。引数は選択されたテーマ ID */
  onThemeChange: (theme: ThemeId) => void;
  /** エージェントツール使用が有効かどうか */
  enableTools: boolean;
  /** ツール使用の有効/無効が切り替わったときに呼ばれる */
  onEnableToolsChange: (enabled: boolean) => void;
  /** 現在選択中のエージェントプロンプトプリセット ID */
  agentPromptPresetId: string;
  /** プロンプトプリセット選択が変わったときに呼ばれる。引数はプリセット ID */
  onAgentPromptPresetChange: (id: string) => void;
}

/**
 * モデル・ツール使用・エージェントプロンプト・テーマを設定するモーダル。
 *
 * `isOpen` が false の間は何も描画しない。ツール使用が有効なときのみ
 * エージェントプロンプトの選択欄を表示する。
 *
 * @param props - 設定値の現在状態と各設定の変更ハンドラー
 */
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
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative w-full max-w-lg mx-4 rounded-2xl bg-nord-1 border border-nord-3 shadow-2xl shadow-black/40">
        <div className="flex items-center justify-between p-6 border-b border-nord-3">
          <h2 className="text-lg font-bold text-nord-6">Settings</h2>
          <IconButton label="閉じる" size="sm" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(100vh-12rem)]">
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-nord-6">
              <Bot size={16} className="text-nord-frost-1" />
              Model
            </label>
            <Select
              value={selectedModel}
              onChange={(e) => onModelChange(e.target.value)}
              className="w-full"
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
            </Select>
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
                <p className="text-sm font-semibold text-nord-6">
                  ツール使用を有効化
                </p>
                <p className="text-xs text-nord-4/60">
                  AIが日時取得・計算などのツールを自律的に使用します
                </p>
              </div>
              <Switch checked={enableTools} className="ml-4" />
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
                      <p className="text-sm font-semibold text-nord-6">
                        {preset.name}
                      </p>
                      <p className="text-xs text-nord-4/60">
                        {preset.description}
                      </p>
                    </div>
                    {agentPromptPresetId === preset.id && <StatusDot />}
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
                  {theme === t.id && <StatusDot />}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end p-6 border-t border-nord-3">
          <Button size="lg" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
