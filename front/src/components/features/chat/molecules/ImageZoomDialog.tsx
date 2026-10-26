'use client';

import type { MessageImage } from '@/types/chat/message';
import Modal from '@/components/common/molecules/Modal';

/** {@link ImageZoomDialog} の props。 */
type ImageZoomDialogProps = {
  /** 拡大する画像。 */
  image: MessageImage;
  /** 画像の代替テキスト（`添付画像 1` 等）。ダイアログの見出しにも使う。 */
  alt: string;
  /** 閉じる要求（×・Escape・背景のクリック）で呼ぶ。 */
  onClose: () => void;
};

/**
 * 添付画像を大きく表示するダイアログ（#6）。
 *
 * 図の拡大（`DiagramZoomDialog`）と同じ共通の `Modal`（`wide`）に、画像をダイアログに収まる大きさで出す。
 * 添付画像は長辺 1,280px に縮小済みのため、倍率の切り替えは置かない。
 *
 * @param props - 画像・代替テキスト・閉じる処理を持つ props
 */
export default function ImageZoomDialog({
  image,
  alt,
  onClose,
}: ImageZoomDialogProps) {
  return (
    <Modal title={alt} onClose={onClose} size="wide" closeOnBackdropClick>
      <div className="h-full flex items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- data: URI と取得 API の画像を、Next の画像最適化を通さずにそのまま出す */}
        <img
          src={image.src}
          alt={alt}
          width={image.width}
          height={image.height}
          className="max-w-full max-h-full w-auto h-auto object-contain"
        />
      </div>
    </Modal>
  );
}
