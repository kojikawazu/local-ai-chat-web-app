'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useChat } from '@/features/chat/hooks/useChat';
import { useConversations } from '@/features/sidebar/hooks/useConversations';
import Sidebar from '@/features/sidebar/components/Sidebar';
import SidebarDrawer from '@/features/sidebar/components/SidebarDrawer';
import Header from '@/features/chat/components/Header';
import ChatWindow from '@/features/chat/components/ChatWindow';
import ChatBar, {
  type ChatBarHandle,
} from '@/features/chat/components/ChatBar';
import Footer from '@/features/chat/components/Footer';
import SettingsModal from '@/components/SettingsModal';
import RoleDialog from '@/features/chat/components/RoleDialog';
import { useTheme } from '@/hooks/useTheme';
import { DEFAULT_PRESET_ID, getPresetById } from '@/lib/agent-prompts';
import { getRoleLabel } from '@/lib/system-prompt';

/**
 * チャット画面のトップページ。サイドバー（モバイルではドロワー）・チャット領域・設定モーダルを統合する。
 *
 * 会話の選択/作成/削除、メッセージ送受信、会話の役割、モデル・ツール・テーマ・エージェント
 * プロンプトの UI 設定を束ね、各機能フックと子コンポーネントへ受け渡す。
 * 会話の役割は会話ごとに DB に持つ。会話を作る前（新規会話）に選んだ役割は下書きとして持ち、
 * 最初の送信で会話と同時に保存する。
 * ツール使用の有効状態とプロンプトプリセットは localStorage に永続化する。
 */
export default function Home() {
  const chatBarRef = useRef<ChatBarHandle>(null);
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isRoleDialogOpen, setIsRoleDialogOpen] = useState(false);
  // 会話を作る前に選んだ役割。最初の送信で会話と同時に保存する
  const [draftSystemPrompt, setDraftSystemPrompt] = useState('');
  // ヘッダーのメニューボタン（aria-controls）とドロワーのパネル（id）を結ぶ id
  const menuId = useId();
  const [enableTools, setEnableTools] = useState(false);
  const [agentPromptPresetId, setAgentPromptPresetId] =
    useState(DEFAULT_PRESET_ID);
  const { theme, setTheme } = useTheme();

  // localStorage に永続化した UI 設定をマウント後に読み込む。
  // why: 遅延初期化（useState(() => localStorage...)）は SSR 時に localStorage へ触れ、
  // サーバー描画（デフォルト値）とクライアント描画（保存値）が食い違いハイドレーション不一致になる。
  // ハイドレーション後に走る effect で同期するのが正しく、setState はマウント時の一度きり。
  // そのため set-state-in-effect はこのパターンに限り無効化する。
  useEffect(() => {
    const stored = localStorage.getItem('agent-tools-enabled');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 上記 why 参照（client-only 同期）
    if (stored === 'true') setEnableTools(true);
    const storedPreset = localStorage.getItem('agent-prompt-preset-id');
    if (storedPreset) setAgentPromptPresetId(storedPreset);
  }, []);

  const handleEnableToolsChange = useCallback((enabled: boolean) => {
    setEnableTools(enabled);
    localStorage.setItem('agent-tools-enabled', String(enabled));
  }, []);

  const handleAgentPromptPresetChange = useCallback((id: string) => {
    setAgentPromptPresetId(id);
    localStorage.setItem('agent-prompt-preset-id', id);
  }, []);

  useEffect(() => {
    async function fetchModels() {
      try {
        const res = await fetch('/api/models');
        if (!res.ok) return;
        const data = await res.json();
        setModels(data.models);
        if (!selectedModel) {
          setSelectedModel(data.defaultModel);
        }
      } catch (error) {
        console.error('Failed to fetch models:', error);
      }
    }
    fetchModels();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const {
    conversations,
    currentConversationId,
    deleteConversation,
    selectConversation,
    updateSystemPrompt,
    refreshConversations,
  } = useConversations();

  const currentConversation = conversations.find(
    (c) => c.id === currentConversationId
  );
  // 作成直後で一覧の再取得が済むまでは会話が一覧に無いため、作成時に送った下書きを使う
  const systemPrompt = currentConversation
    ? (currentConversation.systemPrompt ?? '')
    : draftSystemPrompt;

  const handleSaveRole = useCallback(
    async (prompt: string) => {
      if (currentConversationId) {
        await updateSystemPrompt(currentConversationId, prompt);
      } else {
        setDraftSystemPrompt(prompt);
      }
    },
    [currentConversationId, updateSystemPrompt]
  );

  const skipLoadRef = useRef(false);

  const handleConversationCreated = useCallback(
    (id: string) => {
      skipLoadRef.current = true;
      selectConversation(id);
      refreshConversations();
    },
    [selectConversation, refreshConversations]
  );

  const {
    messages,
    isLoading,
    error,
    activeToolCall,
    generatingConversationIds,
    sendMessage,
    stopGeneration,
    regenerate,
    retrySave,
    clearMessages,
    loadMessages,
    discardConversation,
  } = useChat({
    conversationId: currentConversationId,
    model: selectedModel,
    enableTools,
    systemPrompt,
    agentPrompt: enableTools
      ? (getPresetById(agentPromptPresetId)?.prompt ?? '')
      : '',
    onConversationCreated: handleConversationCreated,
    onTitleGenerated: refreshConversations,
  });

  useEffect(() => {
    if (skipLoadRef.current) {
      skipLoadRef.current = false;
      return;
    }
    if (currentConversationId) {
      loadMessages(currentConversationId);
    } else {
      clearMessages();
    }
  }, [currentConversationId, loadMessages, clearMessages]);

  const isNewConversationMode = !currentConversationId && messages.length === 0;

  const handleNewConversation = useCallback(() => {
    selectConversation(null);
    clearMessages();
    setDraftSystemPrompt('');
    setTimeout(() => chatBarRef.current?.focus(), 0);
  }, [selectConversation, clearMessages]);

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      if (!(await deleteConversation(id))) return;
      // 生成中なら止める。消した会話へ応答を保存しようとして失敗するのを防ぐ
      discardConversation(id);
      if (currentConversationId === id) {
        clearMessages();
        // 消した会話の作成時の下書きが、次の新規会話に持ち越されないようにする
        setDraftSystemPrompt('');
      }
    },
    [
      deleteConversation,
      discardConversation,
      currentConversationId,
      clearMessages,
    ]
  );

  const sidebarProps = {
    conversations,
    currentConversationId,
    generatingConversationIds,
    isNewConversationMode,
    onSelectConversation: selectConversation,
    onNewConversation: handleNewConversation,
    onDeleteConversation: handleDeleteConversation,
    onOpenSettings: () => setIsSettingsOpen(true),
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-nord-0 text-nord-6 font-sans">
      <Sidebar {...sidebarProps} />
      <SidebarDrawer
        id={menuId}
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        {...sidebarProps}
      />

      <main className="flex-1 flex flex-col relative overflow-hidden">
        <Header
          models={models}
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
          menuId={menuId}
          isMenuOpen={isMenuOpen}
          onOpenMenu={() => setIsMenuOpen(true)}
          roleLabel={getRoleLabel(systemPrompt)}
          onOpenRole={() => setIsRoleDialogOpen(true)}
        />
        <ChatWindow
          messages={messages}
          activeToolCall={activeToolCall}
          isLoading={isLoading}
          onRetrySave={retrySave}
          onRegenerate={regenerate}
        />
        {error && (
          <div className="px-4 md:px-8 py-2 bg-nord-aurora-red/20 text-nord-aurora-red text-sm text-center">
            {error}
          </div>
        )}
        <ChatBar
          ref={chatBarRef}
          onSendMessage={sendMessage}
          disabled={isLoading}
          isGenerating={isLoading}
          onStop={stopGeneration}
        />
        <Footer />
      </main>

      {isRoleDialogOpen && (
        <RoleDialog
          initialPrompt={systemPrompt}
          onSave={handleSaveRole}
          onClose={() => setIsRoleDialogOpen(false)}
        />
      )}

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        models={models}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        theme={theme}
        onThemeChange={setTheme}
        enableTools={enableTools}
        onEnableToolsChange={handleEnableToolsChange}
        agentPromptPresetId={agentPromptPresetId}
        onAgentPromptPresetChange={handleAgentPromptPresetChange}
      />
    </div>
  );
}
