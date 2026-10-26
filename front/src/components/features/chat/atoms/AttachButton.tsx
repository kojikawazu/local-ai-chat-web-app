'use client';

import { useRef } from 'react';
import { Paperclip } from 'lucide-react';
import { ACCEPTED_IMAGE_TYPES } from '@/constants/chat/imageAttachment';
import IconButton from '@/components/common/atoms/IconButton';

/** {@link AttachButton} の props。 */
type AttachButtonProps = {
  /** ファイルを選んだときに呼ぶ。選んだファイルを受け取る（形式の検証は呼び出し側で行う）。 */
  onSelectFiles: (files: File[]) => void;
};

/**
 * 画像を添付するクリップのボタン（#6）。押すと隠したファイル選択を開く。
 *
 * 選択の画面では受け付ける形式（{@link ACCEPTED_IMAGE_TYPES}）だけを出し、複数枚を選べる。
 * 同じファイルを続けて選んでも `change` が起きるよう、選んだ後に値を空にする。
 *
 * @param props - ファイルを選んだときの処理を持つ props
 */
export default function AttachButton({ onSelectFiles }: AttachButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <IconButton
        label="画像を添付"
        size="lg"
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip size={20} />
      </IconButton>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(',')}
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          onSelectFiles(files);
        }}
      />
    </>
  );
}
