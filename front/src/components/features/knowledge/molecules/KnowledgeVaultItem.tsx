'use client';

import { useState } from 'react';
import { FolderGit2, RefreshCw, Square } from 'lucide-react';
import type {
  KnowledgeVaultItem as KnowledgeVaultItemData,
  VaultExclusionReason,
  VaultSyncProgress,
} from '@/types/knowledge/vault';
import { VAULT_EXCLUSION_REASONS } from '@/types/knowledge/vault';
import Button from '@/components/common/atoms/Button';

/** 更新の日時の出し方（年は省く。ドキュメントの一覧と同じ） */
const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

/** 取り込まなかった理由の表示名 */
const EXCLUSION_LABELS: Record<VaultExclusionReason, string> = {
  not_text: 'テキスト以外',
  hidden: '隠しフォルダ',
  agent_config: 'エージェントの設定',
  secret: '秘匿ファイル',
  too_large: '1 MB 超',
  not_file: 'リンク等',
};

/** {@link KnowledgeVaultItem} の props。 */
type KnowledgeVaultItemProps = {
  /** 出す保管庫 */
  vault: KnowledgeVaultItemData;
  /** この保管庫の同期の進み具合。まだ同期していなければ `undefined` */
  progress?: VaultSyncProgress;
  /** この保管庫を同期中なら true（止めるボタンを出す） */
  isSyncing: boolean;
  /** ほかの保管庫を同期中・索引の削除の途中なら true（同期を押せなくする） */
  isBlocked: boolean;
  /** 索引の削除の失敗の理由。無ければ `undefined` */
  error?: string;
  /** 「同期」を押したときに呼ぶ */
  onSync: () => void;
  /** 「止める」を押したときに呼ぶ */
  onStop: () => void;
  /** 索引の削除を確かめた後に呼ぶ（設定に無い保管庫だけ） */
  onDelete: () => void;
};

/**
 * 進み具合を 1 行の文にする。
 *
 * @param progress - 進み具合
 * @returns 表示する文
 */
function describeProgress(progress: VaultSyncProgress): string {
  const counts = `取り込み ${progress.imported}・削除 ${progress.removed}・変わらない ${progress.unchanged}`;
  switch (progress.phase) {
    case 'planning':
      return '変わったファイルを確かめています…';
    case 'syncing':
      return `同期中 ${progress.done} / ${progress.total}`;
    case 'done':
      return progress.total === 0
        ? `変わったファイルはありません（${progress.unchanged} ファイル）`
        : `同期しました（${counts}）`;
    case 'stopped':
      return `止めました（${progress.done} / ${progress.total}。${counts}）`;
    case 'error':
      return progress.error ?? '同期に失敗しました';
  }
}

/**
 * RAG の保管庫の 1 行（#235。`docs/28-rag.md`「保管庫の同期（Phase C）」の「画面」）。
 *
 * 名前・フォルダ・読んだ版（git は `main @ a1b2c3d`、フォルダは「フォルダ」）・索引の数を出し、「同期」で差分を取り込む。
 * 同期中は進み具合と「止める」を、終わったら件数・取り込まなかった理由・取り込めなかったファイルを出す。
 * 設定に無い保管庫（索引だけ残っている）は検索に使わないことを出し、索引の削除を 2 段階で確かめる。
 *
 * @param props - 保管庫・進み具合・途中の印・失敗の理由・同期と削除の処理
 */
export default function KnowledgeVaultItem({
  vault,
  progress,
  isSyncing,
  isBlocked,
  error,
  onSync,
  onStop,
  onDelete,
}: KnowledgeVaultItemProps) {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const excluded = progress?.excluded
    .slice()
    .sort(
      (a, b) =>
        VAULT_EXCLUSION_REASONS.indexOf(a.reason) -
        VAULT_EXCLUSION_REASONS.indexOf(b.reason)
    );

  return (
    <li
      aria-label={`保管庫 ${vault.name}`}
      className="rounded-lg border border-nord-3 bg-nord-2 px-3 py-2"
    >
      <div className="flex items-start gap-3">
        <FolderGit2 size={16} className="mt-0.5 shrink-0 text-nord-frost-1" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-semibold text-nord-6">{vault.name}</span>
            {vault.source && (
              <span className="text-xs text-nord-4/70">
                {vault.source.kind === 'git'
                  ? `${vault.source.branch} @ ${vault.source.commit}`
                  : 'フォルダ'}
              </span>
            )}
          </p>
          {vault.root && (
            <p className="truncate text-xs text-nord-4/50" title={vault.root}>
              {vault.root}
            </p>
          )}
          <p className="text-xs text-nord-4/60">
            {vault.documentCount === 0 ? (
              'まだ同期していません'
            ) : (
              <>
                {vault.documentCount} ファイル · {vault.chunkCount} チャンク
                {vault.lastUpdatedAt && (
                  <>
                    {' '}
                    · 最後の更新{' '}
                    <time dateTime={vault.lastUpdatedAt}>
                      {new Date(vault.lastUpdatedAt).toLocaleString(
                        'ja-JP',
                        DATE_FORMAT
                      )}
                    </time>
                  </>
                )}
              </>
            )}
          </p>
          {vault.needsRebuildCount > 0 && vault.configured && (
            <p className="mt-1 text-xs text-nord-aurora-yellow">
              {vault.needsRebuildCount}{' '}
              ファイルの作り直しが要る（同期で今の埋め込みのモデルにします）
            </p>
          )}
          {!vault.configured && (
            <p className="mt-1 text-xs text-nord-aurora-yellow">
              設定（KNOWLEDGE_VAULTS）に無い保管庫です。検索には使いません
            </p>
          )}
          {vault.error && (
            <p role="alert" className="mt-1 text-xs text-nord-aurora-red">
              読めません: {vault.error}
            </p>
          )}
        </div>

        <div className="flex shrink-0 gap-2">
          {vault.configured ? (
            isSyncing ? (
              <Button size="sm" variant="secondary" onClick={onStop}>
                <span className="flex items-center gap-1">
                  <Square size={12} />
                  止める
                </span>
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={onSync}
                disabled={isBlocked || vault.error !== null}
              >
                <span className="flex items-center gap-1">
                  <RefreshCw size={14} />
                  同期
                </span>
              </Button>
            )
          ) : isConfirmingDelete ? (
            <>
              <Button
                size="sm"
                onClick={() => {
                  setIsConfirmingDelete(false);
                  onDelete();
                }}
                disabled={isBlocked}
              >
                消す
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setIsConfirmingDelete(false)}
              >
                やめる
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setIsConfirmingDelete(true)}
              disabled={isBlocked}
            >
              索引を消す
            </Button>
          )}
        </div>
      </div>

      {progress && (
        <div className="mt-2 space-y-1 text-xs">
          <p
            role="status"
            className={
              progress.phase === 'error'
                ? 'text-nord-aurora-red'
                : 'text-nord-4/80'
            }
          >
            {describeProgress(progress)}
          </p>
          {progress.phase === 'syncing' && progress.total > 0 && (
            <progress
              className="h-1 w-full"
              max={progress.total}
              value={progress.done}
              aria-label={`${vault.name} の同期の進み具合`}
            />
          )}
          {excluded && excluded.length > 0 && progress.phase !== 'planning' && (
            <p className="text-nord-4/50">
              取り込まなかった:{' '}
              {excluded
                .map((e) => `${EXCLUSION_LABELS[e.reason]} ${e.count}`)
                .join('・')}
            </p>
          )}
          {progress.failures.length > 0 && (
            <ul
              aria-label={`${vault.name} で取り込めなかったファイル`}
              className="space-y-0.5"
            >
              {progress.failures.map((failure) => (
                <li key={failure.path} className="flex gap-2">
                  <span className="truncate text-nord-6" title={failure.path}>
                    {failure.path}
                  </span>
                  <span className="shrink-0 text-nord-aurora-red">
                    {failure.error}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-nord-aurora-red">
          {error}
        </p>
      )}
    </li>
  );
}
