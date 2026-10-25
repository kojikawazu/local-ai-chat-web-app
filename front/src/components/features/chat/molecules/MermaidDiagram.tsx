'use client';

import type { ReactNode } from 'react';
import { useMermaidDiagram } from '@/hooks/chat/useMermaidDiagram';

/** {@link MermaidDiagram} の props。 */
type MermaidDiagramProps = {
  /** Mermaid のソース（コードブロックの本文）。 */
  source: string;
  /** 応答の生成中か。生成中は描かず、`fallback` を表示する。 */
  isStreaming: boolean;
  /** 図を描けるまで・描けなかったときに表示する、ソースのコードブロック（`pre`）。 */
  fallback: ReactNode;
};

/**
 * Mermaid のソースを図として表示する（#169）。
 *
 * 図は SVG を data: URI にした `<img>` で表示する。DOM に SVG を直接入れないため、ラベルに
 * スクリプトが紛れても実行されない。生成中・描画中はソースを表示し、描けなかったときは
 * ソースの下に mermaid のメッセージを添える。
 *
 * @param props - Mermaid のソース・生成中か・ソースの表示を持つ props
 */
export default function MermaidDiagram({
  source,
  isStreaming,
  fallback,
}: MermaidDiagramProps) {
  const diagram = useMermaidDiagram(source, !isStreaming);

  if (diagram.status === 'rendered') {
    return (
      <div className="p-4 overflow-x-auto flex justify-center bg-nord-0">
        {/* data: URI の SVG は next/image の最適化の対象外で、幅も SVG 側で決まるため素の img を使う */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={diagram.src}
          alt="Mermaid の図"
          data-testid="mermaid-diagram"
          className="max-w-full h-auto"
        />
      </div>
    );
  }

  return (
    <>
      {fallback}
      {diagram.status === 'error' && (
        <p
          data-testid="mermaid-error"
          className="px-4 py-2 border-t border-nord-3 text-xs text-nord-aurora-red whitespace-pre-wrap break-words"
        >
          図を描けませんでした: {diagram.error}
        </p>
      )}
    </>
  );
}
