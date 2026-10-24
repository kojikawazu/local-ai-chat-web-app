'use client';

import { FileJson, FileText } from 'lucide-react';
import type { Message } from '@/types/chat/message';
import type { Conversation } from '@/types/conversation/conversation';
import type { ConversationExportFormat } from '@/lib/chat/export';
import { buildConversationExport } from '@/lib/chat/export';
import { downloadTextFile } from '@/lib/shared/download';
import Button from '@/components/common/atoms/Button';
import Modal from '@/components/common/molecules/Modal';

/** {@link ExportDialog} の props。 */
type ExportDialogProps = {
  /** 書き出す会話 */
  conversation: Conversation;
  /** 表示中のメッセージ（古い順） */
  messages: Message[];
  /** 閉じる要求（キャンセル・閉じるボタン・Escape・背景のクリック）と、書き出した後に呼ぶ */
  onClose: () => void;
};

/** 選べる形式。表示順もこの順 */
const FORMATS: {
  format: ConversationExportFormat;
  name: string;
  description: string;
  icon: typeof FileText;
}[] = [
  {
    format: 'markdown',
    name: 'Markdown',
    description: '読み物として残す。思考過程・ツールの結果は入れない',
    icon: FileText,
  },
  {
    format: 'json',
    name: 'JSON',
    description: 'バックアップとして、ツールの結果なども含めてすべて残す',
    icon: FileJson,
  },
];

/**
 * 表示中の会話全体を書き出すダイアログ（#12）。形式（Markdown・JSON）を選ぶと保存して閉じる。
 *
 * 開いている間だけ描画する（呼び出し側で条件付きで置く）。外枠は共通の {@link Modal}。
 * 入力が無く失うものが無いため、背景のクリックでも閉じる。
 *
 * @param props - 会話・メッセージ・閉じる処理を持つ props
 */
export default function ExportDialog({
  conversation,
  messages,
  onClose,
}: ExportDialogProps) {
  const handleExport = (format: ConversationExportFormat) => {
    const file = buildConversationExport(
      conversation,
      messages,
      format,
      new Date()
    );
    downloadTextFile(file.fileName, file.content, file.mimeType);
    onClose();
  };

  return (
    <Modal
      title="会話を書き出す"
      onClose={onClose}
      closeOnBackdropClick
      footer={
        <Button variant="secondary" onClick={onClose}>
          キャンセル
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-nord-4/80">
          表示中の会話（{messages.length}{' '}
          件のメッセージ）をファイルに保存します。
        </p>
        <div className="grid gap-2">
          {FORMATS.map(({ format, name, description, icon: Icon }) => (
            <button
              key={format}
              type="button"
              onClick={() => handleExport(format)}
              className="flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all bg-nord-2 border border-nord-3 hover:bg-nord-3"
            >
              <Icon size={20} className="shrink-0 text-nord-frost-1" />
              <span className="flex-1">
                <span className="block text-sm font-semibold text-nord-6">
                  {name}
                </span>
                <span className="block text-xs text-nord-4/60">
                  {description}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
