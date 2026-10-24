'use client';

import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_PRESET_ID } from '@/lib/agent/agent-prompts';

const TOOLS_ENABLED_KEY = 'agent-tools-enabled';
const PRESET_ID_KEY = 'agent-prompt-preset-id';

/**
 * エージェントの設定（ツール使用の有効状態・プロンプトのプリセット）を管理し、localStorage に永続化するフック
 * （#163 で `page.tsx` から切り出し）。
 *
 * @returns `enableTools` はツール使用が有効か、`agentPromptPresetId` は選択中のプリセット ID、
 *   `changeEnableTools`・`changeAgentPromptPresetId` は値を変えて保存する関数
 */
export function useAgentSettings() {
  const [enableTools, setEnableTools] = useState(false);
  const [agentPromptPresetId, setAgentPromptPresetId] =
    useState(DEFAULT_PRESET_ID);

  // localStorage に永続化した設定をマウント後に読み込む。
  // why: 遅延初期化（useState(() => localStorage...)）は SSR 時に localStorage へ触れ、
  // サーバー描画（デフォルト値）とクライアント描画（保存値）が食い違いハイドレーション不一致になる。
  // ハイドレーション後に走る effect で同期するのが正しく、setState はマウント時の一度きり。
  // そのため set-state-in-effect はこのパターンに限り無効化する。
  useEffect(() => {
    const stored = localStorage.getItem(TOOLS_ENABLED_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 上記 why 参照（client-only 同期）
    if (stored === 'true') setEnableTools(true);
    const storedPreset = localStorage.getItem(PRESET_ID_KEY);
    if (storedPreset) setAgentPromptPresetId(storedPreset);
  }, []);

  const changeEnableTools = useCallback((enabled: boolean) => {
    setEnableTools(enabled);
    localStorage.setItem(TOOLS_ENABLED_KEY, String(enabled));
  }, []);

  const changeAgentPromptPresetId = useCallback((id: string) => {
    setAgentPromptPresetId(id);
    localStorage.setItem(PRESET_ID_KEY, id);
  }, []);

  return {
    enableTools,
    agentPromptPresetId,
    changeEnableTools,
    changeAgentPromptPresetId,
  };
}
