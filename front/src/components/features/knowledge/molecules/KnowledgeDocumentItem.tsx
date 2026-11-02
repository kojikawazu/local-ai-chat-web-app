'use client';

import { useState } from 'react';
import { FileText, RefreshCw } from 'lucide-react';
import type { KnowledgeDocumentItem as KnowledgeDocumentItemData } from '@/types/knowledge/document';
import Button from '@/components/common/atoms/Button';

/** 更新の日時の出し方（年は省く。ブックマークの一覧と同じ） */
const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

/**
 * バイト数を読みやすい単位にする（1 KB 未満は B、1 MB 未満は KB）。
 *
 * @param bytes - バイト数
 * @returns `512 B`・`12.3 KB`・`1.0 MB` の形
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** {@link KnowledgeDocumentItem} の props。 */
type KnowledgeDocumentItemProps = {
  /** 出すドキュメント */
  document: KnowledgeDocumentItemData;
  /** 作り直し・削除の途中なら true（ボタンを押せなくし、途中であることを出す） */
  isBusy: boolean;
  /** 作り直し・削除の失敗の理由。無ければ `undefined` */
  error?: string;
  /** 「作り直す」を押したときに呼ぶ */
  onRebuild: () => void;
  /** 削除を確かめた後に呼ぶ */
  onDelete: () => void;
};

/**
 * 取り込んだドキュメントの一覧の 1 行（#17。`docs/28-rag.md`「管理画面」）。
 *
 * 名前・大きさ・チャンクの数・更新の日時を出す。今の埋め込みのモデルと違うモデルで作ったドキュメントには
 * 「作り直しが要る」と「作り直す」のボタンを出す。削除は行の中で 2 段階で確かめる（プロンプトテンプレートと同じ）。
 *
 * @param props - ドキュメント・途中の印・失敗の理由・作り直しと削除の処理
 */
export default function KnowledgeDocumentItem({
  document,
  isBusy,
  error,
  onRebuild,
  onDelete,
}: KnowledgeDocumentItemProps) {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  return (
    <li
      aria-label={document.name}
      className="rounded-lg border border-nord-3 bg-nord-2 px-3 py-2"
    >
      <div className="flex items-start gap-3">
        <FileText size={16} className="mt-0.5 shrink-0 text-nord-frost-1" />
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-sm font-semibold text-nord-6"
            title={document.name}
          >
            {document.name}
          </p>
          <p className="text-xs text-nord-4/60">
            {formatSize(document.size)} · {document.chunkCount} チャンク ·{' '}
            <time dateTime={document.updatedAt}>
              {new Date(document.updatedAt).toLocaleString(
                'ja-JP',
                DATE_FORMAT
              )}
            </time>
          </p>
          {document.needsRebuild && (
            <p className="mt-1 text-xs text-nord-aurora-yellow">
              作り直しが要る（{document.embeddingModel}{' '}
              で作ったため、今のモデルでは検索に使いません）
            </p>
          )}
        </div>

        {isConfirmingDelete ? (
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              onClick={() => {
                setIsConfirmingDelete(false);
                onDelete();
              }}
              disabled={isBusy}
            >
              削除する
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setIsConfirmingDelete(false)}
              disabled={isBusy}
            >
              やめる
            </Button>
          </div>
        ) : (
          <div className="flex shrink-0 gap-2">
            {document.needsRebuild && (
              <Button
                size="sm"
                variant="secondary"
                onClick={onRebuild}
                disabled={isBusy}
              >
                <span className="flex items-center gap-1">
                  <RefreshCw size={14} />
                  作り直す
                </span>
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setIsConfirmingDelete(true)}
              disabled={isBusy}
            >
              削除
            </Button>
          </div>
        )}
      </div>

      {isBusy && (
        <p role="status" className="mt-1 text-xs text-nord-4/70">
          処理中…
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-nord-aurora-red">
          {error}
        </p>
      )}
    </li>
  );
}
