'use client';

import { useEffect, useRef } from 'react';
import {
  User,
  Bot,
  TriangleAlert,
  RotateCw,
  CircleStop,
  RefreshCw,
  Download,
} from 'lucide-react';
import type { Message } from '@/types/chat/message';
import { findRegenerateTarget } from '@/lib/chat/regenerate';
import { buildMessageExport } from '@/lib/chat/export';
import { downloadTextFile } from '@/lib/shared/download';
import MarkdownContent from './MarkdownContent';
import CopyButton from '@/components/common/molecules/CopyButton';
import { ToolCallIndicator } from '@/components/features/chat/molecules/ToolCallIndicator';
import { ToolCallResult } from './ToolCallResult';
import { AgentThinking } from './AgentThinking';
import Button from '@/components/common/atoms/Button';
import LoadingDots from '@/components/common/atoms/LoadingDots';
import IconButton from '@/components/common/atoms/IconButton';

/** {@link ChatWindow} の props。 */
type ChatWindowProps = {
  /** 表示する会話メッセージ一覧（時系列順）。空なら空状態のウェルカム画面を表示する。 */
  messages: Message[];
  /** 現在実行中のツール呼び出し。ある場合はスピナー付きインジケーターを表示する。 */
  activeToolCall?: { name: string; arguments: Record<string, unknown> } | null;
  /** 応答生成中か。末尾の空 assistant メッセージと組み合わせて「最初のチャンク待ち」演出を出す。 */
  isLoading?: boolean;
  /** 保存に失敗したメッセージの再試行ボタン押下時のコールバック。メッセージ ID を受け取る。 */
  onRetrySave?: (messageId: string) => void;
  /** 再生成ボタン押下時のコールバック。再生成する応答の ID を受け取る。省略時はボタンを出さない。 */
  onRegenerate?: (messageId: string) => void;
  /** 応答を Markdown で保存するときのファイル名に使う会話のタイトル（#12）。会話が一覧に無い間は空でよい。 */
  conversationTitle?: string;
};

/**
 * チャットのメッセージ一覧を描画するスクロール領域。
 *
 * メッセージ更新時は自動で最下部へスクロールする。assistant の応答は Markdown で
 * 描画し、思考過程・ツール呼び出し結果・ラウンド統計とコピー・Markdown で保存のボタンを付随表示する。停止した応答には
 * 「生成を中断しました」を添える。最初のチャンク
 * 待ち中はドットアニメーションを表示する。保存に失敗したメッセージには失敗表示と
 * 再試行ボタンを付ける（user は「送信失敗・再送」、assistant は「保存失敗・再試行」）。
 * 再生成できる応答（最後の保存済みの応答）には再生成ボタンを付け、生成中は押させない。
 *
 * @param props - メッセージ一覧・実行中ツール・ローディング状態・再試行／再生成コールバックを持つ props
 */
export default function ChatWindow({
  messages,
  activeToolCall,
  isLoading,
  onRetrySave,
  onRegenerate,
  conversationTitle = '',
}: ChatWindowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // 最後のメッセージが assistant かつ content が空 = 最初のチャンク待ち
  const lastMsg = messages[messages.length - 1];
  const isWaitingFirstChunk =
    isLoading && lastMsg?.role === 'assistant' && lastMsg.content === '';
  // 再生成できるのは最後の応答だけ（条件は findRegenerateTarget に集約し、useChat と揃える）
  const regenerableId =
    lastMsg && findRegenerateTarget(messages, lastMsg.id) ? lastMsg.id : null;

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 bg-nord-0 scroll-smooth"
    >
      {messages.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-center opacity-60">
          <div className="p-8 rounded-[2rem] bg-nord-1 border border-nord-3 mb-6 shadow-2xl shadow-black/20">
            <Bot size={56} className="text-nord-frost-1" />
          </div>
          <h2 className="text-3xl font-bold mb-3 text-nord-6">
            Nordic Chat へようこそ
          </h2>
          <p className="max-w-md text-nord-4/60">
            プライベートなローカルAIワークスペースです。何かお手伝いできることはありますか？
          </p>
        </div>
      ) : (
        <>
          {messages.map((msg) => {
            const isThisWaiting = isWaitingFirstChunk && msg.id === lastMsg.id;

            return (
              <div
                key={msg.id}
                className={`flex flex-col max-w-[85%] md:max-w-[70%] ${
                  msg.role === 'user' ? 'ml-auto' : 'mr-auto'
                }`}
              >
                <div
                  className={`p-5 md:p-6 ${
                    msg.role === 'user'
                      ? 'bg-nord-frost-2 text-nord-0 rounded-xl ml-auto font-medium shadow-lg shadow-black/10'
                      : 'bg-nord-2 text-nord-6 rounded-xl mr-auto border border-nord-3'
                  }`}
                >
                  <div className="flex items-start gap-4">
                    {msg.role === 'assistant' && (
                      <Bot
                        size={22}
                        className={`shrink-0 mt-1 text-nord-frost-1 ${isThisWaiting ? 'animate-pulse' : ''}`}
                      />
                    )}
                    {msg.role === 'assistant' ? (
                      isThisWaiting ? (
                        // 最初のチャンク待ちドットアニメーション
                        <LoadingDots label="応答を生成中" />
                      ) : (
                        <MarkdownContent content={msg.content} />
                      )
                    ) : (
                      <div className="whitespace-pre-wrap leading-relaxed text-sm md:text-base">
                        {msg.content}
                      </div>
                    )}
                    {msg.role === 'user' && (
                      <User size={22} className="shrink-0 mt-1 text-nord-0" />
                    )}
                  </div>
                </div>

                {msg.role === 'assistant' && msg.metadata?.thinkingText && (
                  <AgentThinking content={msg.metadata.thinkingText} />
                )}

                {msg.role === 'assistant' &&
                  msg.metadata?.toolCalls &&
                  msg.metadata.toolCalls.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {msg.metadata.toolCalls.map((tc, i) => (
                        <ToolCallResult key={i} toolCall={tc} />
                      ))}
                    </div>
                  )}

                {msg.role === 'assistant' &&
                  (msg.metadata?.agentRounds ?? 0) > 0 && (
                    <div className="mt-1 flex gap-3 text-xs text-[var(--color-nord-4)] opacity-40">
                      <span>{msg.metadata!.agentRounds} ラウンド</span>
                      {msg.metadata!.agentDurationMs !== undefined && (
                        <span>
                          {(msg.metadata!.agentDurationMs / 1000).toFixed(1)}s
                        </span>
                      )}
                    </div>
                  )}

                {!isThisWaiting && (
                  <div
                    className={`flex items-center gap-4 mt-3 px-2 text-xs text-nord-4/60 ${
                      msg.role === 'user' ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    {msg.saveState && (
                      <span
                        role="status"
                        className="flex items-center gap-1 text-nord-aurora-red"
                      >
                        <TriangleAlert size={14} />
                        {msg.role === 'user'
                          ? '送信に失敗しました'
                          : '保存に失敗しました'}
                      </span>
                    )}
                    {msg.saveState && (
                      <Button
                        variant="link"
                        onClick={() => onRetrySave?.(msg.id)}
                        // 再試行中、または応答生成中（user の再送は生成を伴うため）は押させない
                        disabled={msg.saveState === 'retrying' || isLoading}
                      >
                        <RotateCw
                          size={14}
                          className={
                            msg.saveState === 'retrying' ? 'animate-spin' : ''
                          }
                        />
                        {msg.role === 'user' ? '再送' : '再試行'}
                      </Button>
                    )}
                    {msg.role === 'assistant' && msg.metadata?.interrupted && (
                      <span className="flex items-center gap-1">
                        <CircleStop size={14} />
                        生成を中断しました
                      </span>
                    )}
                    {msg.role === 'assistant' && (
                      // 表示ではなく Markdown の原文をコピーする（貼り付け先で書式を再現できる）
                      <CopyButton text={msg.content} label="コピー" />
                    )}
                    {msg.role === 'assistant' && (
                      <IconButton
                        label="Markdown で保存"
                        tone="inherit"
                        size="xs"
                        onClick={() => {
                          const file = buildMessageExport(
                            msg,
                            conversationTitle
                          );
                          downloadTextFile(
                            file.fileName,
                            file.content,
                            file.mimeType
                          );
                        }}
                      >
                        <Download size={14} />
                      </IconButton>
                    )}
                    {onRegenerate && msg.id === regenerableId && (
                      <Button
                        variant="link"
                        onClick={() => onRegenerate(msg.id)}
                        // 生成中（再生成中を含む）は押させない
                        disabled={isLoading}
                      >
                        <RefreshCw size={14} />
                        再生成
                      </Button>
                    )}
                    <span className="opacity-50 font-mono">
                      {msg.createdAt.toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
          {activeToolCall && (
            <div className="mr-auto max-w-[85%] md:max-w-[70%]">
              <ToolCallIndicator
                name={activeToolCall.name}
                arguments={activeToolCall.arguments}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
