'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { Code, Maximize2 } from 'lucide-react';
import type { DiagramKind, DiagramState } from '@/types/chat/diagram';
import IconButton from '@/components/common/atoms/IconButton';
import CodeBlockFrame from '@/components/common/molecules/CodeBlockFrame';
import DiagramZoomDialog from '@/components/features/chat/molecules/DiagramZoomDialog';

/** 図の種類ごとの名前。`<img>` の `alt` と拡大のダイアログの見出しに使う */
const DIAGRAM_LABELS: Record<DiagramKind, string> = {
  mermaid: 'Mermaid の図',
  plantuml: 'PlantUML の図',
};

/** {@link DiagramView} の props。 */
type DiagramViewProps = {
  /** 図の描画の状態（描画のフックの戻り値）。 */
  diagram: DiagramState;
  /** 図の種類。`alt`・ダイアログの見出し・保存のファイル名に使う。 */
  kind: DiagramKind;
  /** 見出し行に出す言語名（コードフェンスに書かれたまま。例: `puml`）。 */
  language: string;
  /** コピーボタンでコピーするソースの原文。 */
  code: string;
  /** 図を描けるまで・描けなかったとき・ソースへ切り替えたときに表示する、ソースのコードブロック（`pre`）。 */
  fallback: ReactNode;
};

/**
 * 図のコードブロック。描画の状態に応じて図かソースを表示する（#169・#171・#176）。
 *
 * 図は SVG を data: URI にした `<img>` で表示する。DOM に SVG を直接入れないため、ラベルに
 * スクリプトが紛れても実行されない。描画中はソースを表示し、描けなかったときはソースの下に理由を添える。
 * 描けているときだけ、見出し行にソースとの切り替え・拡大のボタンを出す。切り替えの状態はブロックごとに持ち、保存しない。
 * 描画（フック）は呼び出し側の organisms が持ち、この部品は表示と UI の状態だけを受け持つ（`docs/12` の階層の判断基準）。
 *
 * @param props - 描画の状態・図の種類・言語名・ソースを持つ props
 */
export default function DiagramView({
  diagram,
  kind,
  language,
  code,
  fallback,
}: DiagramViewProps) {
  const [showSource, setShowSource] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const label = DIAGRAM_LABELS[kind];

  if (diagram.status !== 'rendered') {
    return (
      <CodeBlockFrame language={language} code={code}>
        {fallback}
        {diagram.status === 'error' && (
          <p
            data-testid="diagram-error"
            className="px-4 py-2 border-t border-nord-3 text-xs text-nord-aurora-red whitespace-pre-wrap break-words"
          >
            図を描けませんでした: {diagram.error}
          </p>
        )}
      </CodeBlockFrame>
    );
  }

  return (
    <CodeBlockFrame
      language={language}
      code={code}
      actions={
        <>
          <IconButton
            label="ソースを表示"
            aria-pressed={showSource}
            tone="inherit"
            size="xs"
            onClick={() => setShowSource((current) => !current)}
          >
            <Code
              size={14}
              className={showSource ? 'text-nord-frost-1' : undefined}
            />
          </IconButton>
          <IconButton
            label="図を拡大"
            tone="inherit"
            size="xs"
            onClick={() => setZoomOpen(true)}
          >
            <Maximize2 size={14} />
          </IconButton>
        </>
      }
    >
      {showSource ? (
        fallback
      ) : (
        <div className="p-4 overflow-x-auto flex justify-center bg-nord-0">
          {/* data: URI の SVG は next/image の最適化の対象外で、幅も SVG 側で決まるため素の img を使う */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={diagram.src}
            alt={label}
            data-testid="diagram-image"
            className="max-w-full h-auto"
          />
        </div>
      )}
      {zoomOpen && (
        <DiagramZoomDialog
          kind={kind}
          title={label}
          src={diagram.src}
          svg={diagram.svg}
          onClose={() => setZoomOpen(false)}
        />
      )}
    </CodeBlockFrame>
  );
}
