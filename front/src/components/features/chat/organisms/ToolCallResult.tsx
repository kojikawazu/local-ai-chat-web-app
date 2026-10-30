'use client';

import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { ToolCallInfo, ToolCallStatus } from '@/types/agent/tool-call';
import { TOOL_LABELS } from '@/constants/chat/toolLabels';
import { WebSearchResult } from '@/components/features/chat/molecules/WebSearchResult';
import ToolScreenshots from '@/components/features/chat/molecules/ToolScreenshots';

/** {@link ToolCallResult} の props。 */
type ToolCallResultProps = {
  /** 表示するツール呼び出し情報（名前・引数・結果・エラー有無・要約・所要時間）。 */
  toolCall: ToolCallInfo;
};

/** 結果が届く前の状態の見出し（#192） */
const STATUS_LABELS: Record<ToolCallStatus, string> = {
  running: '実行中…',
  'awaiting-approval': '承認待ち',
};

/**
 * ツール呼び出しを折りたたみ可能なパネルで表示する。
 *
 * 初期状態は折りたたみ。ヘッダーに成否のアイコン・日本語ラベル・要約・所要時間を表示し、
 * 展開すると引数（JSON）と結果を表示する。アイコンは失敗が ❌、空の結果（検索の 0 件等）が ⚠️、
 * それ以外が ✅。失敗の要約（理由）は赤字の 1 行に収め、全文はツールチップで見せる（#150）。
 * web_search かつ成功時は {@link WebSearchResult} でリンク付き表示に切り替える。
 * 結果が届く前（`status` あり）は、成否のアイコンの代わりに実行中のスピナー・承認待ちの ⏳ と状態を出し、
 * 展開しても結果の欄は出さない（#192。許可していないのに ✅ に見えないように）。
 * ブラウザのツールが撮った画面（#200）は、折りたたみの外（見出しの下）に並べ、開かなくても見えるようにする。
 *
 * @param props - 表示するツール呼び出し情報を持つ props
 */
export function ToolCallResult({ toolCall }: ToolCallResultProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const label = TOOL_LABELS[toolCall.name] ?? toolCall.name;
  const durationText =
    toolCall.durationMs > 0 ? `${toolCall.durationMs}ms` : null;

  return (
    <div className="rounded-md border border-[var(--color-nord-3)] bg-[var(--color-nord-1)] text-sm">
      <button
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[var(--color-nord-2)] transition-colors"
      >
        {toolCall.status === 'running' ? (
          <LoaderCircle
            size={16}
            aria-hidden
            className="shrink-0 animate-spin text-[var(--color-nord-8)]"
          />
        ) : toolCall.status === 'awaiting-approval' ? (
          <span className="shrink-0">⏳</span>
        ) : toolCall.isError ? (
          <span className="shrink-0 text-red-400">❌</span>
        ) : toolCall.isEmpty ? (
          <span className="shrink-0 text-yellow-400">⚠️</span>
        ) : (
          <span className="shrink-0 text-green-400">✅</span>
        )}
        <span className="shrink-0 font-medium text-[var(--color-nord-8)]">
          🔧 {label}
        </span>
        {toolCall.status && (
          <span className="min-w-0 truncate text-xs text-[var(--color-nord-4)]">
            {STATUS_LABELS[toolCall.status]}
          </span>
        )}
        {toolCall.summary && (
          <span
            title={toolCall.summary}
            className={`min-w-0 truncate text-xs ${
              toolCall.isError ? 'text-red-400' : 'text-[var(--color-nord-4)]'
            }`}
          >
            {toolCall.summary}
          </span>
        )}
        {durationText && (
          <span className="shrink-0 text-[var(--color-nord-4)] opacity-50 text-xs">
            ({durationText})
          </span>
        )}
        <span className="ml-auto shrink-0 text-[var(--color-nord-4)] opacity-50 text-xs">
          {isExpanded ? '▲' : '▼'}
        </span>
      </button>

      {toolCall.screenshots && toolCall.screenshots.length > 0 && (
        <div className="border-t border-[var(--color-nord-3)] px-3 py-2">
          <ToolScreenshots screenshots={toolCall.screenshots} label={label} />
        </div>
      )}

      {isExpanded && (
        <div className="border-t border-[var(--color-nord-3)] px-3 py-2 space-y-2">
          {Object.keys(toolCall.arguments).length > 0 && (
            <div>
              <p className="text-xs text-[var(--color-nord-4)] opacity-60 mb-1">
                引数
              </p>
              <pre className="text-xs text-[var(--color-nord-4)] whitespace-pre-wrap break-all">
                {JSON.stringify(toolCall.arguments, null, 2)}
              </pre>
            </div>
          )}
          {!toolCall.status && (
            <div>
              <p className="text-xs text-[var(--color-nord-4)] opacity-60 mb-1">
                結果
              </p>
              {toolCall.name === 'web_search' && !toolCall.isError ? (
                <WebSearchResult text={toolCall.result} />
              ) : (
                <pre
                  className={`text-xs whitespace-pre-wrap break-all ${
                    toolCall.isError
                      ? 'text-red-400'
                      : 'text-[var(--color-nord-4)]'
                  }`}
                >
                  {toolCall.result || '(空の結果)'}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
