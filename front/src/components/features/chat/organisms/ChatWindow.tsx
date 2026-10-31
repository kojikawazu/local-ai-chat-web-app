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
  Bookmark,
  GitBranch,
} from 'lucide-react';
import type { Message } from '@/types/chat/message';
import type { ToolApprovalRequest } from '@/types/agent/tool-call';
import { findRegenerateTarget } from '@/lib/chat/regenerate';
import { buildAgentTimeline } from '@/lib/chat/agent-timeline';
import { buildMessageExport } from '@/lib/chat/export';
import { downloadTextFile } from '@/lib/shared/download';
import MarkdownContent from './MarkdownContent';
import CopyButton from '@/components/common/molecules/CopyButton';
import { ToolCallIndicator } from '@/components/features/chat/molecules/ToolCallIndicator';
import MessageImages from '@/components/features/chat/molecules/MessageImages';
import ApprovalCard from '@/components/features/chat/molecules/ApprovalCard';
import ResponseMetrics from '@/components/features/chat/molecules/ResponseMetrics';
import { ToolCallResult } from './ToolCallResult';
import { AgentThinking } from './AgentThinking';
import AgentSteps from './AgentSteps';
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
  /** 承認を待っているツールの実行（届いた順。#148 Phase A2）。先頭の 1 件の承認カードを出す。省略時は無し。 */
  pendingApprovals?: ToolApprovalRequest[];
  /** 承認カードの許可・拒否で呼ぶ。承認 ID と、許可なら true を受け取る。 */
  onRespondApproval?: (approvalId: string, approved: boolean) => void;
  /** 応答の下のブックマークのボタンで呼ぶ（#30）。押した応答を受け取る。省略時はボタンを出さない。 */
  onToggleBookmark?: (message: Message) => void;
  /** 付ける・外すの返事を待っている応答の ID → 向かう先（付けるなら true）。この間はその状態で表示し、押させない。 */
  pendingBookmarks?: Record<string, boolean>;
  /** 直前にブックマークの更新に失敗した応答の ID。その応答の操作の行に失敗を出す。 */
  failedBookmarkId?: string | null;
  /** 移る先の応答の ID（ブックマークの一覧から。#30）。メッセージ一覧に現れたら、そこまでスクロールして枠で示す。 */
  focusMessageId?: string | null;
  /** 移る先へスクロールし終えたときに呼ぶ（呼び出し側が移る先を忘れる）。 */
  onFocusHandled?: () => void;
  /** 応答の下の「ここから分岐」のボタンで呼ぶ（#29）。押した応答の ID を受け取る。省略時はボタンを出さない。 */
  onFork?: (messageId: string) => void;
  /** 分岐の返事を待っている応答の ID（#29）。この間はどの応答の分岐のボタンも押させない（二度押しで 2 つ作らない）。 */
  forkingMessageId?: string | null;
};

// 移った先の応答を枠で示す時間（ms）。読んでいる間ずっと目に入らないよう、短く出して消す
const FOCUS_HIGHLIGHT_MS = 2000;

/**
 * チャットのメッセージ一覧を描画するスクロール領域。
 * user のメッセージに添付画像があれば、本文の上にサムネイルを並べる（#6）。
 *
 * メッセージ更新時は自動で最下部へスクロールする。assistant の応答は Markdown で
 * 描画し、思考過程・ツール呼び出し結果・ラウンド統計とコピー・Markdown で保存のボタンを付随表示する。停止した応答には
 * 「生成を中断しました」を添える。ツールの呼び出しに本文の位置（`contentOffset`）があれば、思考過程 → 説明と
 * ツールの結果（呼んだ順）→ 回答の吹き出しの順に並べ、回答を一番下に出す（#186。古いデータは吹き出し → ツールの一覧）。最初のチャンク
 * 待ち中はドットアニメーションを表示する。保存に失敗したメッセージには失敗表示と
 * 再試行ボタンを付ける（user は「送信失敗・再送」、assistant は「保存失敗・再試行」）。
 * 再生成できる応答（最後の保存済みの応答）には再生成ボタンを付け、生成中は押させない。
 * ツールの実行の承認を待っている間は、実行中の表示の代わりに承認カード（差分と許可・拒否）を一番下に出す（#148 Phase A2）。
 * 保存済みの応答にはブックマークのボタンを付ける（#30）。移る先（`focusMessageId`）がある間は一番下へスクロールせず、
 * その応答が現れたら画面の中央までスクロールし、{@link FOCUS_HIGHLIGHT_MS} だけ枠で示す。
 * 保存済みの応答には「ここから分岐」のボタンも付ける（#29）。生成中・承認待ち（どちらも `isLoading`）と分岐の返事を待つ間は押させない。
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
  pendingApprovals = [],
  onRespondApproval,
  onToggleBookmark,
  pendingBookmarks = {},
  failedBookmarkId = null,
  focusMessageId = null,
  onFocusHandled,
  onFork,
  forkingMessageId = null,
}: ChatWindowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // 移る先を、一番下へのスクロールの effect から依存にせずに読むための写し（#30）。
  // 依存にすると、移った直後に移る先が消えたことで effect が走り直し、一番下へ戻してしまう
  const focusMessageIdRef = useRef(focusMessageId);

  // 下の 2 つの effect より先に写す（effect は宣言の順に走る）
  useEffect(() => {
    focusMessageIdRef.current = focusMessageId;
  }, [focusMessageId]);

  useEffect(() => {
    // 移る先がある間は一番下へ戻さない（会話を読み込んだ直後に、移った位置から引き離さないため。#30）
    if (focusMessageIdRef.current) return;
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, pendingApprovals]);

  useEffect(() => {
    if (!focusMessageId || !scrollRef.current) return;
    // 会話を読み込み終えるまでは、移る先がまだ一覧に無い。現れたときにもう一度走る
    const target = scrollRef.current.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(focusMessageId)}"]`
    );
    if (!target) return;
    target.scrollIntoView({ block: 'center' });
    // 枠は DOM の属性で出す（state にすると、描画の後にもう一度描画が要る）。
    // 消すのはタイマーだけに任せる。後始末で消すと、下の onFocusHandled で移る先が消えたときの再実行で、
    // 出したばかりの枠が消える（会話を切り替えて要素が外れた後に消しても害は無い）
    target.dataset.focused = 'true';
    setTimeout(() => {
      delete target.dataset.focused;
    }, FOCUS_HIGHLIGHT_MS);
    onFocusHandled?.();
  }, [focusMessageId, messages, onFocusHandled]);

  const lastMsg = messages[messages.length - 1];
  // 生成中の応答 = 生成中の最後の assistant。Mermaid の図は生成が終わってから描く（#169）
  const streamingId =
    isLoading && lastMsg?.role === 'assistant' ? lastMsg.id : null;
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
            // ツールの呼び出しに本文の位置があれば、本文とツールの結果を時系列に並べる（#186）
            const timeline =
              msg.role === 'assistant'
                ? buildAgentTimeline(msg.content, msg.metadata?.toolCalls ?? [])
                : null;
            // 吹き出しに出す本文。時系列のときは最後のツールの後の回答だけ
            const bubbleText = timeline ? timeline.answer : msg.content;
            // 生成中の最後の応答で、吹き出しの本文がまだ無い = 次の本文を待っている。
            // ツールの実行中は実行中の表示（ToolCallIndicator）が出るため、待ちの点は出さない
            const isThisWaiting =
              isLoading &&
              msg.id === lastMsg.id &&
              msg.role === 'assistant' &&
              bubbleText === '' &&
              !activeToolCall &&
              pendingApprovals.length === 0;
            // 時系列のとき、回答がまだ無く待ってもいなければ（停止・回答の無い応答）吹き出しを出さない
            const showBubble = !timeline || bubbleText !== '' || isThisWaiting;
            // ブックマークできるのは保存済みの応答だけ（#30）。生成中は保存が終わるまで isLoading が続く
            const canBookmark =
              onToggleBookmark !== undefined &&
              msg.role === 'assistant' &&
              !msg.saveState &&
              msg.id !== streamingId;
            // 分岐できるのも保存済みの応答だけ（#29。保存されていない応答は DB からコピーできない）
            const canFork =
              onFork !== undefined &&
              msg.role === 'assistant' &&
              !msg.saveState &&
              msg.id !== streamingId;
            const isBookmarkPending = msg.id in pendingBookmarks;
            const isBookmarked = isBookmarkPending
              ? pendingBookmarks[msg.id]
              : msg.bookmarkId !== undefined;
            const thinking = msg.role === 'assistant' &&
              msg.metadata?.thinkingText && (
                <AgentThinking content={msg.metadata.thinkingText} />
              );

            return (
              <div
                key={msg.id}
                data-message-id={msg.id}
                className={`flex flex-col max-w-[85%] md:max-w-[70%] rounded-xl transition-shadow duration-500 data-[focused=true]:ring-2 data-[focused=true]:ring-nord-frost-1 data-[focused=true]:ring-offset-4 data-[focused=true]:ring-offset-nord-0 ${
                  msg.role === 'user' ? 'ml-auto' : 'mr-auto'
                }`}
              >
                {timeline && thinking}
                {timeline && timeline.steps.length > 0 && (
                  <div className="mt-2 mb-3">
                    <AgentSteps
                      steps={timeline.steps}
                      isStreaming={msg.id === streamingId}
                    />
                  </div>
                )}

                {showBubble && (
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
                          <MarkdownContent
                            content={bubbleText}
                            isStreaming={msg.id === streamingId}
                          />
                        )
                      ) : (
                        <div className="min-w-0 space-y-3">
                          {msg.images && msg.images.length > 0 && (
                            <MessageImages images={msg.images} />
                          )}
                          <div className="whitespace-pre-wrap leading-relaxed text-sm md:text-base">
                            {msg.content}
                          </div>
                        </div>
                      )}
                      {msg.role === 'user' && (
                        <User size={22} className="shrink-0 mt-1 text-nord-0" />
                      )}
                    </div>
                  </div>
                )}

                {!timeline && thinking}

                {!timeline &&
                  msg.role === 'assistant' &&
                  msg.metadata?.toolCalls &&
                  msg.metadata.toolCalls.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {msg.metadata.toolCalls.map((tc, i) => (
                        <ToolCallResult key={i} toolCall={tc} />
                      ))}
                    </div>
                  )}

                {msg.role === 'assistant' &&
                  ((msg.metadata?.agentRounds ?? 0) > 0 ||
                    msg.metadata?.metrics) && (
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-nord-4)]">
                      {(msg.metadata!.agentRounds ?? 0) > 0 && (
                        <span className="opacity-40">
                          {msg.metadata!.agentRounds} ラウンド
                        </span>
                      )}
                      {(msg.metadata!.agentRounds ?? 0) > 0 &&
                        msg.metadata!.agentDurationMs !== undefined && (
                          <span className="opacity-40">
                            {(msg.metadata!.agentDurationMs / 1000).toFixed(1)}s
                          </span>
                        )}
                      {/* トークン数・生成の速さ（#31）。押すと内訳が開く */}
                      {msg.metadata!.metrics && (
                        <ResponseMetrics metrics={msg.metadata!.metrics} />
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
                    {canBookmark && (
                      <IconButton
                        label={
                          isBookmarked
                            ? 'ブックマークを外す'
                            : 'ブックマークする'
                        }
                        aria-pressed={isBookmarked}
                        tone="inherit"
                        size="xs"
                        onClick={() => onToggleBookmark?.(msg)}
                        // 返事を待つ間は押させない（二度押しで 409 を出さない）
                        disabled={isBookmarkPending}
                      >
                        <Bookmark
                          size={14}
                          fill={isBookmarked ? 'currentColor' : 'none'}
                          className={isBookmarked ? 'text-nord-frost-1' : ''}
                        />
                      </IconButton>
                    )}
                    {canBookmark && failedBookmarkId === msg.id && (
                      <span
                        role="status"
                        className="flex items-center gap-1 text-nord-aurora-red"
                      >
                        <TriangleAlert size={14} />
                        ブックマークの更新に失敗しました
                      </span>
                    )}
                    {canFork && (
                      <IconButton
                        label="ここから分岐"
                        tone="inherit"
                        size="xs"
                        onClick={() => onFork?.(msg.id)}
                        // 生成中・承認待ちは最後の応答が保存されておらず、どこまでコピーされるか分かりにくい
                        disabled={isLoading || forkingMessageId !== null}
                        aria-busy={forkingMessageId === msg.id}
                      >
                        <GitBranch size={14} />
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
          {pendingApprovals.length > 0 ? (
            <div className="mr-auto w-full max-w-[85%] md:max-w-[70%]">
              <ApprovalCard
                key={pendingApprovals[0].approvalId}
                request={pendingApprovals[0]}
                remaining={pendingApprovals.length - 1}
                onRespond={(approved) =>
                  onRespondApproval?.(pendingApprovals[0].approvalId, approved)
                }
              />
            </div>
          ) : (
            activeToolCall && (
              <div className="mr-auto max-w-[85%] md:max-w-[70%]">
                <ToolCallIndicator
                  name={activeToolCall.name}
                  arguments={activeToolCall.arguments}
                />
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
