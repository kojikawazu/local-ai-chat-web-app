'use client';

import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { KNOWLEDGE_FILE_EXTENSIONS } from '@/constants/knowledge/file';
import { useKnowledgeDocuments } from '@/hooks/knowledge/useKnowledgeDocuments';
import { cn } from '@/lib/shared/class-names';
import { MAX_KNOWLEDGE_FILE_BYTES } from '@/lib/shared/validation';
import Button from '@/components/common/atoms/Button';
import Modal from '@/components/common/molecules/Modal';
import KnowledgeDocumentItem from '@/components/features/knowledge/molecules/KnowledgeDocumentItem';

/** {@link KnowledgeDialog} の props。 */
type KnowledgeDialogProps = {
  /** 閉じる要求（閉じるボタン・Escape）で呼ぶ */
  onClose: () => void;
};

/**
 * RAG のドキュメントの管理のダイアログ（#17。`docs/28-rag.md`「管理画面」）。
 *
 * ファイルを選ぶ・ダイアログへ落とすと 1 つずつ取り込み、取り込み中・失敗したファイルを一覧の上に出す。
 * 一覧では作り直し（今の埋め込みのモデルと違うモデルで作ったもの）と削除ができる。
 * 開いている間だけ描画する（呼び出し側で条件付きで置く。開くたびに一覧を読む）。
 * 取り込みの途中で閉じても、サーバーでの取り込みは最後まで進む（次に開いたときの一覧に出る）。
 *
 * @param props - 閉じるときの処理
 */
export default function KnowledgeDialog({ onClose }: KnowledgeDialogProps) {
  const {
    status,
    documents,
    embeddingModel,
    loadError,
    uploads,
    busyIds,
    itemErrors,
    importFiles,
    rebuildDocument,
    deleteDocument,
  } = useKnowledgeDocuments();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const isImporting = uploads.some((u) => u.state !== 'error');

  return (
    <Modal
      title="ドキュメント"
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          閉じる
        </Button>
      }
    >
      <div
        className="space-y-4"
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          // 中の要素へ移ったときの dragleave は無視する（枠の外へ出たときだけ消す）
          const next = e.relatedTarget;
          if (!(next instanceof Node && e.currentTarget.contains(next))) {
            setIsDragging(false);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          void importFiles([...e.dataTransfer.files]);
        }}
      >
        <p className="text-sm text-nord-4/80">
          取り込んだドキュメントは、会話で参照できるようになります（会話での参照は次の更新で入ります）。
          {KNOWLEDGE_FILE_EXTENSIONS.join('・')} のファイルを、1 つ{' '}
          {MAX_KNOWLEDGE_FILE_BYTES / 1024 / 1024} MB
          まで取り込めます。同じ名前のファイルは置き換えます。
        </p>

        <div
          className={cn(
            'flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-sm transition-colors',
            isDragging
              ? 'border-nord-frost-1 bg-nord-frost-1/10'
              : 'border-nord-3'
          )}
        >
          <Button
            variant="secondary"
            onClick={() => inputRef.current?.click()}
            className="border border-nord-3"
          >
            <span className="flex items-center gap-2">
              <Upload size={16} />
              ファイルを選ぶ
            </span>
          </Button>
          <span className="text-xs text-nord-4/60">
            またはここにファイルを落とす
          </span>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={KNOWLEDGE_FILE_EXTENSIONS.join(',')}
            aria-label="取り込むファイル"
            className="hidden"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              // 同じファイルを続けて選んでも change が起きるよう、選んだ後に空にする
              e.target.value = '';
              void importFiles(files);
            }}
          />
        </div>

        {uploads.length > 0 && (
          <ul aria-label="取り込み中のファイル" className="space-y-1 text-sm">
            {uploads.map((upload) => (
              <li key={upload.key} className="flex gap-2">
                <span className="truncate text-nord-6" title={upload.name}>
                  {upload.name}
                </span>
                {upload.state === 'error' ? (
                  <span role="alert" className="text-nord-aurora-red">
                    {upload.error}
                  </span>
                ) : (
                  <span role="status" className="shrink-0 text-nord-4/70">
                    {upload.state === 'importing' ? '取り込み中…' : '順番待ち'}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {documents.length > 0 && (
          <ul aria-label="ドキュメントの一覧" className="space-y-2">
            {documents.map((document) => (
              <KnowledgeDocumentItem
                key={document.id}
                document={document}
                isBusy={busyIds.includes(document.id)}
                error={itemErrors[document.id]}
                onRebuild={() => void rebuildDocument(document.id)}
                onDelete={() => void deleteDocument(document.id)}
              />
            ))}
          </ul>
        )}

        <div role="status" className="text-sm text-nord-4/70">
          {status === 'loading' && '読み込み中…'}
          {status === 'done' &&
            documents.length === 0 &&
            !isImporting &&
            'ドキュメントはまだありません'}
          {status === 'error' && (
            <span className="text-nord-aurora-red">{loadError}</span>
          )}
        </div>

        {embeddingModel && (
          <p className="text-xs text-nord-4/50">
            埋め込みのモデル: {embeddingModel}
          </p>
        )}
      </div>
    </Modal>
  );
}
