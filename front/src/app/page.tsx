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
import BookmarkDialog from '@/components/features/bookmark/organisms/BookmarkDialog';
import ShortcutHelpDialog from '@/components/features/shortcut/organisms/ShortcutHelpDialog';
import ChatLayout from '@/components/common/templates/ChatLayout';
import { useModels } from '@/hooks/chat/useModels';
import { useImageAttachments } from '@/hooks/chat/useImageAttachments';
import { useAgentSettings } from '@/hooks/settings/useAgentSettings';
import { usePromptTemplates } from '@/hooks/prompt-template/usePromptTemplates';
import { useMessageBookmark } from '@/hooks/bookmark/useMessageBookmark';
import { useConversationFork } from '@/hooks/chat/useConversationFork';
import { useKeyboardShortcuts } from '@/hooks/shortcut/useKeyboardShortcuts';
import { useSidebarVisibility } from '@/hooks/sidebar/useSidebarVisibility';
import { useTheme } from '@/hooks/theme/useTheme';
import { getPresetById } from '@/lib/agent/agent-prompts';
import { getRoleLabel } from '@/lib/chat/system-prompt';
import { adjacentConversationId } from '@/lib/sidebar/list-navigation';
import { DESKTOP_MEDIA_QUERY } from '@/constants/sidebar/layout';
import type { BookmarkListItem } from '@/types/bookmark/bookmark';
import type { Conversation } from '@/types/conversation/conversation';
import type { Message } from '@/types/chat/message';

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
 * 応答のブックマーク（#30）の付け外しは {@link useMessageBookmark} が持ち、一覧のダイアログから移る先の応答は
 * ここで持つ（会話を開いてから、`ChatWindow` がその応答までスクロールする）。
 * 応答から会話を分岐する（#29）のは {@link useConversationFork} が持ち、分岐できたら一覧を読み直して新しい会話を開く。
 * ヘッダーの分岐元のリンクは、ブックマークと同じ移る先の仕組みで、分岐元の会話のその応答へ移る。
 * ページ全体のショートカット（#33）は {@link useKeyboardShortcuts} が受け、ここで操作（新しい会話・検索・サイドバー・
 * 入力欄・前後の会話・ヘルプ）に繋ぐ。サイドバー・検索は、デスクトップの幅ではサイドバー、狭い幅ではドロワーを開く。
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
  // 応答の下の「保存」で書き出す応答（#36）。ダイアログを開いている間だけ持つ
  const [exportMessage, setExportMessage] = useState<Message | null>(null);
  const [isTemplateDialogOpen, setIsTemplateDialogOpen] = useState(false);
  const [isBookmarkDialogOpen, setIsBookmarkDialogOpen] = useState(false);
  const [isShortcutHelpOpen, setIsShortcutHelpOpen] = useState(false);
  // 検索欄にフォーカスする要求（#33。⌘K）。見えている検索欄がフォーカスしたら null に戻す
  const [searchFocusRequest, setSearchFocusRequest] = useState<number | null>(
    null
  );
  // ブックマークの一覧・分岐元のリンク（#29）から移る先（#30）。その会話を開いている間だけ ChatWindow へ渡す
  const [focusTarget, setFocusTarget] = useState<{
    conversationId: string;
    messageId: string;
  } | null>(null);
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
    setMessageBookmark,
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

  const messageBookmark = useMessageBookmark({ onChange: setMessageBookmark });
  const focusMessageId =
    focusTarget?.conversationId === currentConversationId
      ? focusTarget.messageId
      : null;
  const handleFocusHandled = useCallback(() => setFocusTarget(null), []);

  const handleOpenBookmark = useCallback(
    (bookmark: BookmarkListItem) => {
      setIsBookmarkDialogOpen(false);
      setFocusTarget({
        conversationId: bookmark.conversationId,
        messageId: bookmark.messageId,
      });
      selectConversation(bookmark.conversationId);
    },
    [selectConversation]
  );

  const handleOpenForkSource = useCallback(() => {
    const source = currentConversation?.forkedFrom;
    if (!source) return;
    setFocusTarget({
      conversationId: source.conversationId,
      messageId: source.messageId,
    });
    selectConversation(source.conversationId);
  }, [currentConversation, selectConversation]);

  const handleForked = useCallback(
    (conversation: Conversation) => {
      setFocusTarget(null);
      // 一覧に載ってから開く（先に開くと、一覧に無い間だけ役割・分岐元が空で出る）
      void refreshConversations().finally(() => {
        selectConversation(conversation.id);
        setTimeout(() => chatBarRef.current?.focus(), 0);
      });
    },
    [refreshConversations, selectConversation]
  );
  const conversationFork = useConversationFork({ onForked: handleForked });
  const handleFork = useCallback(
    (messageId: string) => {
      if (currentConversationId) {
        void conversationFork.fork(currentConversationId, messageId);
      }
    },
    [conversationFork, currentConversationId]
  );
  // 分岐の失敗は、分岐元の会話を開いている間だけ出す
  const forkError =
    conversationFork.error?.conversationId === currentConversationId
      ? conversationFork.error.message
      : null;

  const handleSelectConversation = useCallback(
    (id: string) => {
      // 移る先の会話を開けないまま別の会話を選んだら、移る先を忘れる（後で戻ったときに急に移らない）
      setFocusTarget(null);
      selectConversation(id);
    },
    [selectConversation]
  );

  const handleNewConversation = useCallback(() => {
    setFocusTarget(null);
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

  const handleOpenShortcuts = useCallback(() => {
    // 設定モーダルから開くときも、ダイアログを重ねない
    setIsSettingsOpen(false);
    setIsShortcutHelpOpen(true);
  }, []);

  const handleSearchFocused = useCallback(
    () => setSearchFocusRequest(null),
    []
  );

  const isDesktop = () => window.matchMedia(DESKTOP_MEDIA_QUERY).matches;

  useKeyboardShortcuts({
    // ドロワーの中のキー（Tab の循環・Escape）はドロワーに任せる。モーダルはフックが <dialog open> で見る
    blocked: isMenuOpen,
    handlers: {
      newConversation: () => {
        if (!isNewConversationMode) handleNewConversation();
      },
      searchConversations: () => {
        if (isDesktop()) {
          if (!sidebar.isOpen) sidebar.toggle();
        } else {
          setIsMenuOpen(true);
        }
        setSearchFocusRequest((n) => (n ?? 0) + 1);
      },
      toggleSidebar: () => {
        if (isDesktop()) {
          sidebar.toggle();
        } else {
          setIsMenuOpen(true);
        }
      },
      focusInput: () => chatBarRef.current?.focus(),
      previousConversation: () => {
        const id = adjacentConversationId(
          conversations.map((c) => c.id),
          currentConversationId,
          'previous'
        );
        if (id) handleSelectConversation(id);
      },
      nextConversation: () => {
        const id = adjacentConversationId(
          conversations.map((c) => c.id),
          currentConversationId,
          'next'
        );
        if (id) handleSelectConversation(id);
      },
      showHelp: () => setIsShortcutHelpOpen(true),
    },
  });

  const sidebarProps = {
    conversations,
    currentConversationId,
    generatingConversationIds,
    isNewConversationMode,
    onSelectConversation: handleSelectConversation,
    onNewConversation: handleNewConversation,
    onDeleteConversation: handleDeleteConversation,
    onOpenSettings: () => setIsSettingsOpen(true),
    onOpenBookmarks: () => setIsBookmarkDialogOpen(true),
    searchFocusRequest,
    onSearchFocused: handleSearchFocused,
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
          forkSourceTitle={currentConversation?.forkedFrom?.title ?? null}
          onOpenForkSource={handleOpenForkSource}
        />
      }
      notice={forkError ?? error}
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
              target={{
                kind: 'conversation',
                conversation: currentConversation,
                messages,
              }}
              onClose={() => setIsExportDialogOpen(false)}
            />
          )}
          {exportMessage && (
            <ExportDialog
              target={{
                kind: 'message',
                message: exportMessage,
                title: currentConversation?.title ?? '',
              }}
              onClose={() => setExportMessage(null)}
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
          {isShortcutHelpOpen && (
            <ShortcutHelpDialog onClose={() => setIsShortcutHelpOpen(false)} />
          )}
          {isBookmarkDialogOpen && (
            <BookmarkDialog
              onOpenBookmark={handleOpenBookmark}
              onRemoved={(messageId) => setMessageBookmark(messageId, null)}
              onClose={() => setIsBookmarkDialogOpen(false)}
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
            onOpenShortcuts={handleOpenShortcuts}
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
        onSaveMessage={setExportMessage}
        pendingApprovals={pendingApprovals}
        onRespondApproval={respondToApproval}
        onToggleBookmark={messageBookmark.toggleBookmark}
        pendingBookmarks={messageBookmark.pending}
        failedBookmarkId={messageBookmark.failedMessageId}
        focusMessageId={focusMessageId}
        onFocusHandled={handleFocusHandled}
        onFork={currentConversationId ? handleFork : undefined}
        forkingMessageId={conversationFork.forkingMessageId}
      />
    </ChatLayout>
  );
}
