'use client';

import { useState } from 'react';
import type { MessageImage } from '@/types/chat/message';
import ImageZoomDialog from './ImageZoomDialog';

/** {@link MessageImages} の props。 */
type MessageImagesProps = {
  /** メッセージに添付した画像（並び順）。 */
  images: MessageImage[];
};

/**
 * 画像の代替テキスト。並び順で区別する。
 *
 * @param index - 0 始まりの並び順
 * @returns `添付画像 1` の形の文字列
 */
function imageAlt(index: number): string {
  return `添付画像 ${index + 1}`;
}

/**
 * メッセージの中の添付画像のサムネイルを並べる（#6）。押すと拡大する（{@link ImageZoomDialog}）。
 *
 * サムネイルは高さを揃え、幅は画像の縦横比に合わせる。`width` / `height` を渡して、
 * 読み込みの前から枠を確保する（読み込み後にメッセージの高さが変わって画面が跳ねないように）。
 *
 * @param props - 画像の一覧を持つ props
 */
export default function MessageImages({ images }: MessageImagesProps) {
  const [zoomedIndex, setZoomedIndex] = useState<number | null>(null);
  const zoomed = zoomedIndex === null ? undefined : images[zoomedIndex];

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {images.map((image, index) => (
          <button
            key={image.id}
            type="button"
            aria-label={`${imageAlt(index)} を拡大`}
            onClick={() => setZoomedIndex(index)}
            className="rounded-lg overflow-hidden border border-black/10 bg-nord-0/20 hover:opacity-90 transition"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- data: URI と取得 API の画像を、Next の画像最適化を通さずにそのまま出す */}
            <img
              src={image.src}
              alt={imageAlt(index)}
              width={image.width}
              height={image.height}
              className="h-[120px] w-auto max-w-full object-cover"
            />
          </button>
        ))}
      </div>
      {zoomed && zoomedIndex !== null && (
        <ImageZoomDialog
          image={zoomed}
          alt={imageAlt(zoomedIndex)}
          onClose={() => setZoomedIndex(null)}
        />
      )}
    </>
  );
}
