'use client';

import { useState } from 'react';
import { Brain } from 'lucide-react';

interface AgentThinkingProps {
  content: string;
}

export function AgentThinking({ content }: AgentThinkingProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (!content.trim()) return null;

  return (
    <div className="rounded-md border border-[var(--color-nord-3)] bg-[var(--color-nord-0)]/50 text-sm mb-2">
      <button
        onClick={() => setIsExpanded((prev) => !prev)}
        aria-expanded={isExpanded}
        aria-label={isExpanded ? '思考過程を折りたたむ' : '思考過程を展開する'}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[var(--color-nord-1)] transition-colors rounded-md"
      >
        <Brain size={14} className="text-[var(--color-nord-9)] shrink-0" />
        <span className="text-xs font-medium text-[var(--color-nord-9)]">思考過程</span>
        <span className="ml-auto text-[var(--color-nord-4)] opacity-50 text-xs">
          {isExpanded ? '▲' : '▼'}
        </span>
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 pt-1 border-t border-[var(--color-nord-3)]">
          <pre className="text-xs text-[var(--color-nord-4)] opacity-70 whitespace-pre-wrap break-all leading-relaxed">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}
