'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useChat } from '@/features/chat/hooks/useChat';
import { useConversations } from '@/features/sidebar/hooks/useConversations';
import Sidebar from '@/features/sidebar/components/Sidebar';
import Header from '@/features/chat/components/Header';
import ChatWindow from '@/features/chat/components/ChatWindow';
import ChatBar, { type ChatBarHandle } from '@/features/chat/components/ChatBar';
import Footer from '@/features/chat/components/Footer';
import SettingsModal from '@/components/SettingsModal';
import { useTheme } from '@/hooks/useTheme';
import { DEFAULT_PRESET_ID, getPresetById } from '@/lib/agent-prompts';

export default function Home() {
  const chatBarRef = useRef<ChatBarHandle>(null);
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [enableTools, setEnableTools] = useState(false);
  const [agentPromptPresetId, setAgentPromptPresetId] = useState(DEFAULT_PRESET_ID);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    const stored = localStorage.getItem('agent-tools-enabled');
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
    refreshConversations,
  } = useConversations();

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
    sendMessage,
    clearMessages,
    loadMessages,
  } = useChat({
    conversationId: currentConversationId,
    model: selectedModel,
    enableTools,
    systemPrompt: enableTools ? (getPresetById(agentPromptPresetId)?.prompt ?? '') : '',
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
    setTimeout(() => chatBarRef.current?.focus(), 0);
  }, [selectConversation, clearMessages]);

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      await deleteConversation(id);
      if (currentConversationId === id) {
        clearMessages();
      }
    },
    [deleteConversation, currentConversationId, clearMessages]
  );

  return (
    <div className="flex h-screen w-full overflow-hidden bg-nord-0 text-nord-6 font-sans">
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        isNewConversationMode={isNewConversationMode}
        onSelectConversation={selectConversation}
        onNewConversation={handleNewConversation}
        onDeleteConversation={handleDeleteConversation}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      <main className="flex-1 flex flex-col relative overflow-hidden">
        <Header
          models={models}
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
        />
        <ChatWindow messages={messages} activeToolCall={activeToolCall} />
        {error && (
          <div className="px-4 md:px-8 py-2 bg-nord-aurora-red/20 text-nord-aurora-red text-sm text-center">
            {error}
          </div>
        )}
        <ChatBar ref={chatBarRef} onSendMessage={sendMessage} disabled={isLoading} />
        <Footer />
      </main>

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
