'use client';

import { useState } from 'react';
import { ToolCallInfo } from '@/types';
import { TOOL_LABELS } from '../constants/toolLabels';

interface ToolCallResultProps {
  toolCall: ToolCallInfo;
}

// web_search 結果をリンク付きで表示するサブコンポーネント
function WebSearchResult({ text }: { text: string }) {
  // "[N] タイトル\n    URL: https://...\n    スニペット" 形式をパース
  const blocks = text.split(/\[(\d+)\] /).slice(1);
  const items: { index: string; title: string; url: string; snippet: string }[] = [];

  for (let i = 0; i < blocks.length; i += 2) {
    const index = blocks[i];
    const body = blocks[i + 1] ?? '';
    const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
    const title = lines[0] ?? '';
    const urlLine = lines.find((l) => l.startsWith('URL:'));
    const url = urlLine ? urlLine.replace('URL:', '').trim() : '';
    const snippet = lines.filter((l) => !l.startsWith('URL:')).slice(1).join(' ');
    items.push({ index, title, url, snippet });
  }

  if (items.length === 0) {
    return <p className="text-xs text-[var(--color-nord-4)]">{text}</p>;
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.index} className="text-xs">
          <p className="font-medium text-[var(--color-nord-8)]">
            [{item.index}]{' '}
            {item.url ? (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-[var(--color-nord-9)] transition-colors"
              >
                {item.title}
              </a>
            ) : (
              item.title
            )}
          </p>
          {item.snippet && (
            <p className="text-[var(--color-nord-4)] opacity-80 mt-0.5">{item.snippet}</p>
          )}
        </div>
      ))}
    </div>
  );
}

export function ToolCallResult({ toolCall }: ToolCallResultProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const label = TOOL_LABELS[toolCall.name] ?? toolCall.name;
  const durationText = toolCall.durationMs > 0 ? `${toolCall.durationMs}ms` : null;

  return (
    <div className="rounded-md border border-[var(--color-nord-3)] bg-[var(--color-nord-1)] text-sm">
      <button
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[var(--color-nord-2)] transition-colors"
      >
        {toolCall.isError ? (
          <span className="text-red-400">❌</span>
        ) : (
          <span className="text-green-400">✅</span>
        )}
        <span className="font-medium text-[var(--color-nord-8)]">🔧 {label}</span>
        {durationText && (
          <span className="text-[var(--color-nord-4)] opacity-50 text-xs">({durationText})</span>
        )}
        <span className="ml-auto text-[var(--color-nord-4)] opacity-50 text-xs">
          {isExpanded ? '▲' : '▼'}
        </span>
      </button>

      {isExpanded && (
        <div className="border-t border-[var(--color-nord-3)] px-3 py-2 space-y-2">
          {Object.keys(toolCall.arguments).length > 0 && (
            <div>
              <p className="text-xs text-[var(--color-nord-4)] opacity-60 mb-1">引数</p>
              <pre className="text-xs text-[var(--color-nord-4)] whitespace-pre-wrap break-all">
                {JSON.stringify(toolCall.arguments, null, 2)}
              </pre>
            </div>
          )}
          <div>
            <p className="text-xs text-[var(--color-nord-4)] opacity-60 mb-1">結果</p>
            {toolCall.name === 'web_search' && !toolCall.isError ? (
              <WebSearchResult text={toolCall.result} />
            ) : (
              <pre
                className={`text-xs whitespace-pre-wrap break-all ${
                  toolCall.isError ? 'text-red-400' : 'text-[var(--color-nord-4)]'
                }`}
              >
                {toolCall.result || '(空の結果)'}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
