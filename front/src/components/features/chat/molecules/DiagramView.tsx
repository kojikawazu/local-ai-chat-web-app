'use client';

import type { ReactNode } from 'react';
import type { DiagramState } from '@/types/chat/diagram';

/** {@link DiagramView} の props。 */
type DiagramViewProps = {
  /** 図の描画の状態（描画のフックの戻り値）。 */
  diagram: DiagramState;
  /** 図の `<img>` の代替テキスト（例: `Mermaid の図`）。 */
  alt: string;
  /** 図を描けるまで・描けなかったときに表示する、ソースのコードブロック（`pre`）。 */
  fallback: ReactNode;
};

/**
 * 描画の状態に応じて、図かソースを表示する（#169・#171）。
 *
 * 図は SVG を data: URI にした `<img>` で表示する。DOM に SVG を直接入れないため、ラベルに
 * スクリプトが紛れても実行されない。描画中はソースを表示し、描けなかったときはソースの下に理由を添える。
 * 描画（フック）は呼び出し側の organisms が持ち、この部品は表示だけを受け持つ（`docs/12` の階層の判断基準）。
 *
 * @param props - 描画の状態・代替テキスト・ソースの表示を持つ props
 */
export default function DiagramView({
  diagram,
  alt,
  fallback,
}: DiagramViewProps) {
  if (diagram.status === 'rendered') {
    return (
      <div className="p-4 overflow-x-auto flex justify-center bg-nord-0">
        {/* data: URI の SVG は next/image の最適化の対象外で、幅も SVG 側で決まるため素の img を使う */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={diagram.src}
          alt={alt}
          data-testid="diagram-image"
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
          data-testid="diagram-error"
          className="px-4 py-2 border-t border-nord-3 text-xs text-nord-aurora-red whitespace-pre-wrap break-words"
        >
          図を描けませんでした: {diagram.error}
        </p>
      )}
    </>
  );
}
