'use client';

import { useEffect, useRef } from 'react';
import { User, Bot, Copy } from 'lucide-react';
import { Message } from '@/types';
import MarkdownContent from './MarkdownContent';
import { ToolCallIndicator } from './ToolCallIndicator';
import { ToolCallResult } from './ToolCallResult';
import { AgentThinking } from './AgentThinking';

/** {@link ChatWindow} の props。 */
interface ChatWindowProps {
  /** 表示する会話メッセージ一覧（時系列順）。空なら空状態のウェルカム画面を表示する。 */
  messages: Message[];
  /** 現在実行中のツール呼び出し。ある場合はスピナー付きインジケーターを表示する。 */
  activeToolCall?: { name: string; arguments: Record<string, unknown> } | null;
  /** 応答生成中か。末尾の空 assistant メッセージと組み合わせて「最初のチャンク待ち」演出を出す。 */
  isLoading?: boolean;
}

/**
 * チャットのメッセージ一覧を描画するスクロール領域。
 *
 * メッセージ更新時は自動で最下部へスクロールする。assistant の応答は Markdown で
 * 描画し、思考過程・ツール呼び出し結果・ラウンド統計を付随表示する。最初のチャンク
 * 待ち中はドットアニメーションを表示する。
 *
 * @param props - メッセージ一覧・実行中ツール・ローディング状態を持つ props
 */
export default function ChatWindow({ messages, activeToolCall, isLoading }: ChatWindowProps) {
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
                      <div className="flex items-center gap-1.5 py-1" aria-label="応答を生成中">
                        <span className="w-2 h-2 rounded-full bg-nord-frost-1 animate-bounce [animation-delay:0ms]" />
                        <span className="w-2 h-2 rounded-full bg-nord-frost-1 animate-bounce [animation-delay:150ms]" />
                        <span className="w-2 h-2 rounded-full bg-nord-frost-1 animate-bounce [animation-delay:300ms]" />
                      </div>
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

              {msg.role === 'assistant' && msg.metadata?.toolCalls && msg.metadata.toolCalls.length > 0 && (
                <div className="mt-2 space-y-1">
                  {msg.metadata.toolCalls.map((tc, i) => (
                    <ToolCallResult key={i} toolCall={tc} />
                  ))}
                </div>
              )}

              {msg.role === 'assistant' && (msg.metadata?.agentRounds ?? 0) > 0 && (
                <div className="mt-1 flex gap-3 text-xs text-[var(--color-nord-4)] opacity-40">
                  <span>{msg.metadata!.agentRounds} ラウンド</span>
                  {msg.metadata!.agentDurationMs !== undefined && (
                    <span>{(msg.metadata!.agentDurationMs / 1000).toFixed(1)}s</span>
                  )}
                </div>
              )}

              {!isThisWaiting && (
                <div
                  className={`flex items-center gap-4 mt-3 px-2 text-xs text-nord-4/60 ${
                    msg.role === 'user' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  {msg.role === 'assistant' && (
                    <button
                      className="hover:text-nord-frost-1 transition-colors"
                      onClick={() => navigator.clipboard.writeText(msg.content)}
                      aria-label="コピー"
                    >
                      <Copy size={14} />
                    </button>
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
            <ToolCallIndicator name={activeToolCall.name} arguments={activeToolCall.arguments} />
          </div>
        )}
        </>
      )}
    </div>
  );
}
