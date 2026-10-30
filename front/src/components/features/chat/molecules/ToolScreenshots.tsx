'use client';

import { useState } from 'react';
import type { ToolScreenshot } from '@/types/agent/tool-call';
import { screenshotSrc } from '@/lib/chat/tool-screenshots';
import ElementBoxOverlay from '../atoms/ElementBoxOverlay';
import ImageZoomDialog from './ImageZoomDialog';

/** {@link ToolScreenshots} の props。 */
type ToolScreenshotsProps = {
  /** ブラウザのツールが撮った画面（撮った順） */
  screenshots: ToolScreenshot[];
  /** ツールの表示名（`クリック` 等）。画像の代替テキストに使う */
  label: string;
};

/** 画面の種類の見出し */
const KIND_LABELS: Record<ToolScreenshot['kind'], string> = {
  before: '操作の前',
  after: '操作の後',
};

/**
 * 画像の代替テキスト。ツールと画面の種類で区別する。
 *
 * @param label - ツールの表示名
 * @param shot - 画面
 * @returns `クリック の操作の前の画面` の形の文字列
 */
function screenshotAlt(label: string, shot: ToolScreenshot): string {
  return shot.kind === 'before'
    ? `${label} の操作の前の画面`
    : `${label} の後の画面`;
}

/**
 * ブラウザのツールが撮った画面を並べる（#200。`docs/18-browser-tools.md`「画面をチャットに出す」）。
 *
 * 画面の文字を読めるよう、置かれた欄（ツールの結果・承認カード）の幅いっぱいに、縦に並べて出す（小さいサムネイルでは読めないため）。
 * 操作の前の画面には、操作する要素を枠で囲む（{@link ElementBoxOverlay}）。押すと拡大し、拡大でも枠を出す。
 * 操作の前の画面があるときは、前と後を見分けられるよう、画像の上に見出しを付ける。
 * `width` / `height` を渡して、読み込みの前から枠を確保する（画面が跳ねないように）。
 *
 * @param props - 画面の一覧・ツールの表示名を持つ props
 */
export default function ToolScreenshots({
  screenshots,
  label,
}: ToolScreenshotsProps) {
  const [zoomed, setZoomed] = useState<ToolScreenshot | null>(null);
  const showKind = screenshots.some((shot) => shot.kind === 'before');

  return (
    <>
      <div className="flex flex-col gap-3">
        {screenshots.map((shot) => {
          const alt = screenshotAlt(label, shot);
          return (
            <figure key={shot.id} className="flex flex-col gap-1">
              {showKind && (
                <figcaption className="text-xs text-[var(--color-nord-4)] opacity-70">
                  {KIND_LABELS[shot.kind]}
                </figcaption>
              )}
              <button
                type="button"
                aria-label={`${alt} を拡大`}
                onClick={() => setZoomed(shot)}
                className="relative block w-full overflow-hidden rounded-md border border-[var(--color-nord-3)] hover:opacity-90 transition"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- data: URI と取得 API の画像を、Next の画像最適化を通さずにそのまま出す */}
                <img
                  src={screenshotSrc(shot)}
                  alt={alt}
                  width={shot.width}
                  height={shot.height}
                  className="block h-auto w-full"
                />
                {shot.box && (
                  <ElementBoxOverlay
                    box={shot.box}
                    imageWidth={shot.width}
                    imageHeight={shot.height}
                    fit="exact"
                  />
                )}
              </button>
            </figure>
          );
        })}
      </div>
      {zoomed && (
        <ImageZoomDialog
          image={{
            id: zoomed.id,
            src: screenshotSrc(zoomed),
            width: zoomed.width,
            height: zoomed.height,
          }}
          alt={screenshotAlt(label, zoomed)}
          box={zoomed.box}
          onClose={() => setZoomed(null)}
        />
      )}
    </>
  );
}
