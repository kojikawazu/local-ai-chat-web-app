'use client';

import { useCallback, useState } from 'react';
import type { PreparedImage } from '@/types/chat/attachment';
import { prepareImage, selectFilesToAttach } from '@/lib/chat/image-attachment';
import { MAX_IMAGES_PER_MESSAGE } from '@/lib/shared/validation';

/**
 * 送信前に添付している画像の状態を管理するフック（#6）。
 *
 * ファイル選択・ドラッグ＆ドロップ・貼り付けのどれも {@link addFiles} に渡す。形式・大きさ・枚数を確かめてから、
 * 1 枚ずつブラウザで縮小・再エンコードし（`prepareImage`）、一度に渡した分が全部終わってから選んだ順に足す。
 * 外した理由は `errors` に持ち、次に添付するか {@link clear} するまで出し続ける。
 *
 * @returns `images` は添付済みの画像（添付した順）、`preparingCount` は準備中の枚数、`errors` は直近の添付で
 *   外した理由、`addFiles` はファイルを添付する関数、`removeImage` は ID 指定で 1 枚外す関数、
 *   `clear` は送信後などに全部を空にする関数
 */
export function useImageAttachments() {
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [preparingCount, setPreparingCount] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const { accepted, errors: rejected } = selectFilesToAttach(
        files,
        images.length + preparingCount
      );
      setErrors(rejected);
      if (accepted.length === 0) return;
      setPreparingCount((count) => count + accepted.length);

      // 小さい画像ほど早く終わるため、終わった順に足すと並びが選んだ順とずれる。全部を待って選んだ順に足す
      Promise.allSettled(accepted.map((file) => prepareImage(file))).then(
        (results) => {
          const prepared: PreparedImage[] = [];
          const failed: string[] = [];
          results.forEach((result, index) => {
            if (result.status === 'fulfilled') {
              prepared.push(result.value);
            } else {
              failed.push(
                result.reason instanceof Error
                  ? result.reason.message
                  : `「${accepted[index].name}」を添付できませんでした`
              );
            }
          });
          // 準備の間に続けて添付された分で上限を超えないよう、足す時点でも確かめる
          setImages((prev) =>
            [...prev, ...prepared].slice(0, MAX_IMAGES_PER_MESSAGE)
          );
          if (failed.length > 0) setErrors((prev) => [...prev, ...failed]);
          setPreparingCount((count) => count - accepted.length);
        }
      );
    },
    [images.length, preparingCount]
  );

  const removeImage = useCallback((id: string) => {
    setImages((prev) => prev.filter((image) => image.id !== id));
  }, []);

  const clear = useCallback(() => {
    setImages([]);
    setErrors([]);
  }, []);

  return { images, preparingCount, errors, addFiles, removeImage, clear };
}
