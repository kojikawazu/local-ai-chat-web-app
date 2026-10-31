'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useChat } from '@/hooks/chat/useChat';
import { useConversations } from '@/hooks/sidebar/useConversations';
import Sidebar from '@/components/features/sidebar/organisms/Sidebar';
import SidebarDrawer from '@/components/features/sidebar/organisms/SidebarDrawer';
import Header from '@/components/features/chat/organisms/Header';
import ChatWindow from '@/components/features/chat/organisms/ChatWindow';
import ChatBar, {
  type ChatBarHandle,
} from '@/components/features/chat/organisms/ChatBar';
import Footer from '@/components/features/chat/organisms/Footer';
import SettingsModal from '@/components/features/settings/organisms/SettingsModal';
import RoleDialog from '@/components/features/chat/organisms/RoleDialog';
import ExportDialog from '@/components/features/chat/organisms/ExportDialog';
import PromptTemplateDialog from '@/components/features/prompt-template/organisms/PromptTemplateDialog';
import ChatLayout from '@/components/common/templates/ChatLayout';
import { useModels } from '@/hooks/chat/useModels';
import { useImageAttachments } from '@/hooks/chat/useImageAttachments';
import { useAgentSettings } from '@/hooks/settings/useAgentSettings';
import { usePromptTemplates } from '@/hooks/prompt-template/usePromptTemplates';
import { useSidebarVisibility } from '@/hooks/sidebar/useSidebarVisibility';
import { useTheme } from '@/hooks/theme/useTheme';
import { getPresetById } from '@/lib/agent/agent-prompts';
import { getRoleLabel } from '@/lib/chat/system-prompt';

/**
 * チャット画面のトップページ。サイドバー（モバイルではドロワー）・チャット領域・設定モーダルを統合する。
 * 画面の枠は {@link ChatLayout} が持ち、ここでは各機能の organisms を組み立てて渡す（#163）。
 *
 * 会話の選択/作成/削除、メッセージ送受信、会話の役割、モデル・ツール・テーマ・エージェント
 * プロンプトの UI 設定を束ね、各機能フックと子コンポーネントへ受け渡す。
 * 会話の役割は会話ごとに DB に持つ。会話を作る前（新規会話）に選んだ役割は下書きとして持ち、
 * 最初の送信で会話と同時に保存する。
 * モデル一覧は {@link useModels}、ツール使用の有効状態とプロンプトプリセットの永続化は {@link useAgentSettings}、
 * デスクトップのサイドバーの表示・非表示（#24）は {@link useSidebarVisibility} が持つ。
 * 送信前に添付している画像（#6）は {@link useImageAttachments} が持ち、送信したら空にする。
 * 入力欄の `/` の候補と管理画面のプロンプトテンプレート（#28）は {@link usePromptTemplates} が持つ。
 */
export default function Home() {
  const chatBarRef = useRef<ChatBarHandle>(null);
  const { models, visionModels, selectedModel, setSelectedModel } = useModels();
  const attachments = useImageAttachments();
  // 画像に対応しているかが分からない間（一覧の取得前・失敗）は案内を出さず、サーバーの判定に任せる
  const unsupportedImageModel =
    visionModels !== null &&
    selectedModel !== '' &&
    !visionModels.includes(selectedModel)
      ? selectedModel
      : null;
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isRoleDialogOpen, setIsRoleDialogOpen] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isTemplateDialogOpen, setIsTemplateDialogOpen] = useState(false);
  const promptTemplates = usePromptTemplates();
  // 会話を作る前に選んだ役割。最初の送信で会話と同時に保存する
  const [draftSystemPrompt, setDraftSystemPrompt] = useState('');
  // ヘッダーのメニューボタン（aria-controls）とドロワーのパネル（id）を結ぶ id
  const menuId = useId();
  // ヘッダーのサイドバーの切り替えボタン（aria-controls）とデスクトップのサイドバー（id）を結ぶ id
  const sidebarId = useId();
  const sidebar = useSidebarVisibility();
  const {
    enableTools,
    agentPromptPresetId,
    changeEnableTools,
    changeAgentPromptPresetId,
  } = useAgentSettings();
  const { theme, setTheme } = useTheme();

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
    pendingApprovals,
    generatingConversationIds,
    sendMessage,
    stopGeneration,
    regenerate,
    retrySave,
    respondToApproval,
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

  const handleSendMessage = useCallback(
    (content: string) => {
      sendMessage(content, attachments.images);
      attachments.clear();
    },
    [sendMessage, attachments]
  );

  const isNewConversationMode = !currentConversationId && messages.length === 0;
  // 生成中は本文が途中のため書き出させない。作成直後で一覧に無い間も、会話の情報が無いため書き出せない
  const canExport =
    currentConversation !== undefined && messages.length > 0 && !isLoading;

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

  const handleAddExampleTemplates = useCallback(async () => {
    try {
      await promptTemplates.addExampleTemplates();
    } catch (error) {
      // 候補から押したときは出す場所が無い。一覧は読み直してあるため、作られていればそのまま候補に出る
      console.error('Failed to add example prompt templates:', error);
    }
  }, [promptTemplates]);

  const handleOpenTemplateDialog = useCallback(() => {
    // 設定モーダルから開くときも、ダイアログを重ねない
    setIsSettingsOpen(false);
    setIsTemplateDialogOpen(true);
  }, []);

  const handleCloseTemplateDialog = useCallback(() => {
    setIsTemplateDialogOpen(false);
    setTimeout(() => chatBarRef.current?.focus(), 0);
  }, []);

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
    <ChatLayout
      sidebar={
        <Sidebar
          id={sidebarId}
          isOpen={sidebar.isOpen}
          animate={sidebar.isReady}
          {...sidebarProps}
        />
      }
      drawer={
        <SidebarDrawer
          id={menuId}
          isOpen={isMenuOpen}
          onClose={() => setIsMenuOpen(false)}
          {...sidebarProps}
        />
      }
      header={
        <Header
          models={models}
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
          menuId={menuId}
          isMenuOpen={isMenuOpen}
          onOpenMenu={() => setIsMenuOpen(true)}
          sidebarId={sidebarId}
          isSidebarOpen={sidebar.isOpen}
          onToggleSidebar={sidebar.toggle}
          isNewConversationMode={isNewConversationMode}
          onNewConversation={handleNewConversation}
          onOpenSettings={() => setIsSettingsOpen(true)}
          roleLabel={getRoleLabel(systemPrompt)}
          onOpenRole={() => setIsRoleDialogOpen(true)}
          canExport={canExport}
          onOpenExport={() => setIsExportDialogOpen(true)}
        />
      }
      notice={error}
      composer={
        <ChatBar
          ref={chatBarRef}
          onSendMessage={handleSendMessage}
          disabled={isLoading}
          isGenerating={isLoading}
          onStop={stopGeneration}
          onAddImages={attachments.addFiles}
          images={attachments.images}
          preparingImageCount={attachments.preparingCount}
          attachmentErrors={attachments.errors}
          unsupportedImageModel={unsupportedImageModel}
          onRemoveImage={attachments.removeImage}
          templates={promptTemplates.templates}
          onManageTemplates={handleOpenTemplateDialog}
          onAddExampleTemplates={handleAddExampleTemplates}
        />
      }
      footer={<Footer />}
      dialogs={
        <>
          {isExportDialogOpen && currentConversation && (
            <ExportDialog
              conversation={currentConversation}
              messages={messages}
              onClose={() => setIsExportDialogOpen(false)}
            />
          )}
          {isTemplateDialogOpen && (
            <PromptTemplateDialog
              templates={promptTemplates.templates}
              onCreate={promptTemplates.createTemplate}
              onUpdate={promptTemplates.updateTemplate}
              onDelete={promptTemplates.deleteTemplate}
              onAddExamples={promptTemplates.addExampleTemplates}
              onClose={handleCloseTemplateDialog}
            />
          )}
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
            onEnableToolsChange={changeEnableTools}
            agentPromptPresetId={agentPromptPresetId}
            onAgentPromptPresetChange={changeAgentPromptPresetId}
            onOpenPromptTemplates={handleOpenTemplateDialog}
          />
        </>
      }
    >
      <ChatWindow
        messages={messages}
        activeToolCall={activeToolCall}
        isLoading={isLoading}
        onRetrySave={retrySave}
        onRegenerate={regenerate}
        conversationTitle={currentConversation?.title}
        pendingApprovals={pendingApprovals}
        onRespondApproval={respondToApproval}
      />
    </ChatLayout>
  );
}
