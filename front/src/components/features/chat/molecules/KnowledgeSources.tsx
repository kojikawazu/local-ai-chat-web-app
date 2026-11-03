'use client';

import { useId, useState } from 'react';
import { BookOpen, ChevronDown } from 'lucide-react';
import type { KnowledgeSource } from '@/types/knowledge/document';
import { cn } from '@/lib/shared/class-names';

/** {@link KnowledgeSources} の props。 */
type KnowledgeSourcesProps = {
  /** 送ったときに探したドキュメントの出典。空なら「見つからなかった」を出す */
  sources: KnowledgeSource[];
};

/**
 * 応答の出典（参照したドキュメント）の要約と、押して開く一覧（#17 Phase B。`docs/28-rag.md`「出典の表示」）。
 *
 * 要約は「参照したドキュメント（3）」のボタン（`aria-expanded`）で、一覧はその下に開く。一覧はドキュメントの名前・
 * 見出し・抜き出しの先頭・類似度を並べ、抜き出しは Markdown として描かずに文字のまま出す（React のエスケープ）。
 * 探したが見つからなかったときは、探したことが分かるように文で伝える。
 * {@link ResponseMetrics} と同じく、折り返す横並びの中に置く前提で、一覧は `basis-full` で次の行に出す。
 *
 * @param props - 出典を持つ props
 */
export default function KnowledgeSources({ sources }: KnowledgeSourcesProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();

  if (sources.length === 0) {
    return (
      <span className="flex items-center gap-1 opacity-60">
        <BookOpen size={12} aria-hidden />
        参照できるドキュメントが見つかりませんでした
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1 opacity-60 hover:opacity-100 transition-opacity"
      >
        <BookOpen size={12} aria-hidden />
        参照したドキュメント（{sources.length}）
        <ChevronDown
          size={12}
          aria-hidden
          className={cn('transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <ol
          id={listId}
          aria-label="参照したドキュメント"
          className="basis-full space-y-2 rounded-lg border border-nord-3 bg-nord-1 px-3 py-2"
        >
          {sources.map((source, index) => (
            <li key={index} className="space-y-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-bold text-nord-4/90 break-all">
                  {source.documentName}
                </span>
                {source.heading && (
                  <span className="text-nord-4/60 break-all">
                    {source.heading}
                  </span>
                )}
                <span className="ml-auto text-nord-4/60 tabular-nums">
                  類似度 {source.similarity.toFixed(2)}
                </span>
              </div>
              <p className="text-nord-4/80 whitespace-pre-wrap break-all">
                {source.excerpt}
              </p>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
