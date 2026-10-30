import type { ScreenshotBox } from '@/types/agent/tool-call';

/** {@link ElementBoxOverlay} の props。 */
type ElementBoxOverlayProps = {
  /** 操作する要素の位置（画像の左上からの px） */
  box: ScreenshotBox;
  /** 画像の幅（px）。枠の座標の基準にする */
  imageWidth: number;
  /** 画像の高さ（px）。枠の座標の基準にする */
  imageHeight: number;
  /**
   * 重ねる画像の収め方。`exact` は画像と同じ大きさの枠に重ねる（サムネイル）、
   * `contain` は `object-contain` で縮小した画像に重ねる（拡大のダイアログ）
   */
  fit: 'exact' | 'contain';
};

/**
 * スクリーンショットの上に、操作する要素を囲む枠を重ねる（#200）。
 *
 * 親（`relative`）いっぱいに SVG を置き、`viewBox` を画像の画素にして枠を描く。画像と同じ収め方
 * （`preserveAspectRatio`）にすることで、縮小・拡大しても枠が要素に重なる。線の太さは画面の px で一定にする。
 * 画像の上の操作（押して拡大）を邪魔しないよう、ポインターのイベントは受けない。
 *
 * @param props - 要素の位置・画像の大きさ・収め方を持つ props
 */
export default function ElementBoxOverlay({
  box,
  imageWidth,
  imageHeight,
  fit,
}: ElementBoxOverlayProps) {
  return (
    <svg
      aria-hidden
      data-testid="element-box"
      viewBox={`0 0 ${imageWidth} ${imageHeight}`}
      preserveAspectRatio={fit === 'exact' ? 'none' : 'xMidYMid meet'}
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      <rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        fill="none"
        stroke="var(--color-nord-aurora-yellow)"
        strokeWidth={3}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
