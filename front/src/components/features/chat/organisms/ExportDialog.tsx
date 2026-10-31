'use client';

import type { LucideIcon } from 'lucide-react';
import {
  FileCode,
  FileJson,
  FileText,
  FileType,
  Presentation,
  Printer,
} from 'lucide-react';
import type { Message } from '@/types/chat/message';
import type { Conversation } from '@/types/conversation/conversation';
import { buildConversationExport, buildMessageExport } from '@/lib/chat/export';
import { downloadTextFile } from '@/lib/shared/download';
import type { ReportFormat } from '@/hooks/chat/useReportExport';
import { useReportExport } from '@/hooks/chat/useReportExport';
import Button from '@/components/common/atoms/Button';
import Modal from '@/components/common/molecules/Modal';

/** 書き出す対象。会話全体か、応答 1 件か */
type ExportTarget =
  | {
      /** 会話全体 */
      kind: 'conversation';
      /** 書き出す会話 */
      conversation: Conversation;
      /** 表示中のメッセージ（古い順） */
      messages: Message[];
    }
  | {
      /** 応答 1 件（#36。応答の下の「保存」から） */
      kind: 'message';
      /** 書き出す応答 */
      message: Message;
      /** ファイル名・レポートの見出しに使う会話のタイトル（会話が一覧に無い間は空でよい） */
      title: string;
    };

/** {@link ExportDialog} の props。 */
type ExportDialogProps = {
  /** 書き出す対象 */
  target: ExportTarget;
  /** 閉じる要求（キャンセル・閉じるボタン・Escape・背景のクリック）と、書き出した後に呼ぶ */
  onClose: () => void;
};

/** 選べる形式 */
type ExportFormat = 'markdown' | ReportFormat | 'json';

/** 形式の表示。表示順は {@link formatsOf} が決める */
const FORMAT_LABELS: Record<
  ExportFormat,
  { name: string; description: string; icon: LucideIcon }
> = {
  markdown: {
    name: 'Markdown',
    description: '原文のまま残す。思考過程・ツールの結果は入れない',
    icon: FileText,
  },
  html: {
    name: 'HTML',
    description:
      '整形したレポートを 1 ファイルで保存する（図・画像も入る）。ブラウザで開いて読める',
    icon: FileCode,
  },
  pdf: {
    name: 'PDF',
    description:
      '同じレポートを印刷の画面で開く。印刷先で「PDF として保存」を選ぶ',
    icon: Printer,
  },
  docx: {
    name: 'DOCX',
    description:
      'Word で編集できるファイルで保存する（図・画像も入る。コードの色は付けない）',
    icon: FileType,
  },
  slides: {
    name: 'スライド',
    description:
      'ブラウザで開いて発表できるスライドで保存する（区切り線（---）か見出しで 1 枚ずつ分ける。↓・スペースで次へ）',
    icon: Presentation,
  },
  json: {
    name: 'JSON',
    description: 'バックアップとして、ツールの結果なども含めてすべて残す',
    icon: FileJson,
  },
};

/**
 * 対象ごとに選べる形式（表示順）。応答 1 件には JSON を出さない（会話のバックアップの形式のため）。
 * スライドは応答 1 件だけ（質問と応答が交互に並ぶ会話は発表の形にならないため。#36）。
 *
 * @param target - 書き出す対象
 * @returns 形式の一覧
 */
function formatsOf(target: ExportTarget): ExportFormat[] {
  return target.kind === 'conversation'
    ? ['markdown', 'html', 'pdf', 'docx', 'json']
    : ['markdown', 'html', 'pdf', 'docx', 'slides'];
}

/**
 * 会話全体・応答 1 件を書き出すダイアログ（#12。HTML・PDF・DOCX・スライドは #36）。形式を選ぶと保存して閉じる。
 *
 * Markdown・JSON はその場で保存する。HTML・PDF・DOCX・スライドは図を描き・画像を読んでから組み立てるため、
 * その間はボタンを押せなくして「作成中…」を出し、失敗したらダイアログの中にエラーを出す（閉じない）。
 * 開いている間だけ描画する（呼び出し側で条件付きで置く）。外枠は共通の {@link Modal}。
 * 入力が無く失うものが無いため、背景のクリックでも閉じる（作成中は閉じない）。
 *
 * @param props - 書き出す対象・閉じる処理を持つ props
 */
export default function ExportDialog({ target, onClose }: ExportDialogProps) {
  const report = useReportExport();

  const handleExport = async (format: ExportFormat) => {
    if (format !== 'markdown' && format !== 'json') {
      const exported = await report.exportReport(
        target.kind === 'conversation'
          ? {
              format,
              mode: 'conversation',
              title: target.conversation.title,
              systemPrompt: target.conversation.systemPrompt,
              messages: target.messages,
              exportedAt: new Date(),
            }
          : {
              format,
              mode: 'message',
              title: target.title,
              systemPrompt: null,
              messages: [target.message],
              exportedAt: new Date(),
            }
      );
      if (exported) onClose();
      return;
    }
    const file =
      target.kind === 'conversation'
        ? buildConversationExport(
            target.conversation,
            target.messages,
            format,
            new Date()
          )
        : buildMessageExport(target.message, target.title);
    downloadTextFile(file.fileName, file.content, file.mimeType);
    onClose();
  };

  return (
    <Modal
      title={target.kind === 'conversation' ? '会話を書き出す' : '応答を保存'}
      onClose={onClose}
      closeDisabled={report.isWorking}
      closeOnBackdropClick
      footer={
        <Button
          variant="secondary"
          onClick={onClose}
          disabled={report.isWorking}
        >
          キャンセル
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-nord-4/80">
          {target.kind === 'conversation'
            ? `表示中の会話（${target.messages.length} 件のメッセージ）をファイルに保存します。`
            : 'この応答をファイルに保存します。'}
        </p>
        <div className="grid gap-2">
          {formatsOf(target).map((format) => {
            const { name, description, icon: Icon } = FORMAT_LABELS[format];
            return (
              <button
                key={format}
                type="button"
                onClick={() => void handleExport(format)}
                disabled={report.isWorking}
                className="flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all bg-nord-2 border border-nord-3 hover:bg-nord-3 disabled:opacity-50 disabled:cursor-not-allowed"
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
            );
          })}
        </div>
        {report.isWorking && (
          <p role="status" className="text-xs text-nord-4/80">
            レポートを作成中…
          </p>
        )}
        {report.error && (
          <p role="alert" className="text-xs text-nord-aurora-red">
            {report.error}
          </p>
        )}
      </div>
    </Modal>
  );
}
