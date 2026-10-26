'use client';

import { TriangleAlert, X } from 'lucide-react';
import type { MessageImage } from '@/types/chat/message';
import IconButton from '@/components/common/atoms/IconButton';
import LoadingDots from '@/components/common/atoms/LoadingDots';

/** {@link AttachmentPreview} の props。 */
type AttachmentPreviewProps = {
  /** 添付済みの画像（添付した順）。 */
  images: MessageImage[];
  /** 縮小・再エンコードの途中の枚数。その数だけ準備中の枠を出す。 */
  preparingCount: number;
  /** 直近の添付で外した理由。 */
  errors: string[];
  /** 選択中のモデルが画像に対応していないときのモデル名。対応している・分からないときは `null`。 */
  unsupportedModel: string | null;
  /** 画像の削除ボタンで呼ぶ。外す画像の ID を受け取る。 */
  onRemove: (id: string) => void;
};

/**
 * 送信前に添付した画像の一覧（#6）。サムネイルと削除ボタン、準備中の枠、添付できなかった理由、
 * 画像に対応していないモデルの案内を出す。どれも無ければ何も描かない。
 *
 * 非対応のモデルの案内は、画像を添付しているときだけ出す（添付していなければ送信に関係しない）。
 *
 * @param props - 添付の状態と削除の処理を持つ props
 */
export default function AttachmentPreview({
  images,
  preparingCount,
  errors,
  unsupportedModel,
  onRemove,
}: AttachmentPreviewProps) {
  const showUnsupported = unsupportedModel !== null && images.length > 0;
  if (
    images.length === 0 &&
    preparingCount === 0 &&
    errors.length === 0 &&
    !showUnsupported
  ) {
    return null;
  }

  return (
    <div className="mb-3 space-y-2">
      {(images.length > 0 || preparingCount > 0) && (
        <ul aria-label="添付した画像" className="flex flex-wrap gap-2">
          {images.map((image, index) => (
            <li
              key={image.id}
              className="relative h-16 w-16 rounded-lg overflow-hidden border border-nord-3 bg-nord-2"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- 手元の data: URI を、Next の画像最適化を通さずにそのまま出す */}
              <img
                src={image.src}
                alt={`添付する画像 ${index + 1}`}
                className="h-full w-full object-cover"
              />
              {/* 画像の上でも見えるよう、ボタンの下に暗い円を敷く（IconButton の色は外から変えない） */}
              <span className="absolute top-0.5 right-0.5 flex rounded-full bg-nord-0/80 p-0.5">
                <IconButton
                  label={`添付する画像 ${index + 1} を外す`}
                  tone="default"
                  size="xs"
                  onClick={() => onRemove(image.id)}
                >
                  <X size={14} />
                </IconButton>
              </span>
            </li>
          ))}
          {Array.from({ length: preparingCount }, (_, index) => (
            <li
              key={`preparing-${index}`}
              className="h-16 w-16 rounded-lg border border-dashed border-nord-3 flex items-center justify-center"
            >
              <LoadingDots label="画像を準備中" />
            </li>
          ))}
        </ul>
      )}
      {showUnsupported && (
        <p
          role="status"
          className="flex items-center gap-1 text-xs text-nord-aurora-yellow"
        >
          <TriangleAlert size={14} className="shrink-0" />
          選択中のモデル（{unsupportedModel}
          ）は画像に対応していません。画像に対応したモデルに切り替えるか、画像を外してください
        </p>
      )}
      {errors.length > 0 && (
        <ul role="alert" className="space-y-1 text-xs text-nord-aurora-red">
          {errors.map((error, index) => (
            // 同じ名前のファイルを 2 つ外すと文言が重なるため、並び順を key にする（一覧は添付のたびに作り直す）
            <li key={index}>{error}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
