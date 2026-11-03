'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  KnowledgeVaultItem,
  VaultFileSyncStatus,
  VaultSyncPlanResponse,
  VaultSyncProgress,
} from '@/types/knowledge/vault';

const VAULTS_URL = '/api/knowledge/vaults';

/**
 * API の失敗の応答から、利用者へ見せる文を取り出す。
 *
 * @param res - 失敗の応答
 * @param fallback - API が `error` を返さなかったときの文
 * @returns 理由の文
 */
async function errorOf(res: Response, fallback: string): Promise<string> {
  const data: { error?: unknown } = await res.json().catch(() => ({}));
  return typeof data.error === 'string'
    ? data.error
    : `${fallback} (${res.status})`;
}

/**
 * 保管庫名をパスに入れる形にする。
 *
 * @param name - 保管庫の名前
 * @returns URL の 1 区切りに入れられる形
 */
function vaultUrl(name: string): string {
  return `${VAULTS_URL}/${encodeURIComponent(name)}`;
}

/**
 * RAG の保管庫（#235。`docs/28-rag.md`「保管庫の同期（Phase C）」）の一覧を読み、同期・索引の削除を提供するフック。
 *
 * マウント時に一覧を読む。同期は差分を求めてから、足す・変わった・作り直し・消えたパスを 1 つずつ同期の API に渡し、
 * 進み具合を保管庫ごとに持つ。同時に同期するのは 1 つの保管庫だけ。止めると、同期中のファイルの後で止まる
 * （済んだ分は残る）。埋め込み・保管庫・DB の失敗（API の失敗）は、ほかのファイルでも起きるため、そこで止める。
 * 中身を取り込めないファイル（`rejected`）は失敗のファイルとして残し、続ける。アンマウント（ダイアログを閉じる）でも止める。
 *
 * @returns `status`（一覧の読み込みの状態）・`vaults`・`loadError`・`progress`（保管庫ごとの進み具合）・
 *   `syncingName`（同期中の保管庫）・`busyNames`（索引の削除の途中）・`itemErrors`（保管庫ごとの削除の失敗）と、
 *   `syncVault`・`stopSync`・`deleteVaultIndex`
 */
export function useKnowledgeVaults() {
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');
  const [vaults, setVaults] = useState<KnowledgeVaultItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, VaultSyncProgress>>(
    {}
  );
  const [syncingName, setSyncingName] = useState<string | null>(null);
  const [busyNames, setBusyNames] = useState<string[]>([]);
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  // 同期中の保管庫を止める信号。止めるボタン・アンマウントで abort する
  const abortRef = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(VAULTS_URL);
      if (!res.ok) {
        setLoadError(await errorOf(res, '保管庫の一覧の取得に失敗しました'));
        setStatus('error');
        return;
      }
      const data: { vaults: KnowledgeVaultItem[] } = await res.json();
      setVaults(data.vaults);
      setLoadError(null);
      setStatus('done');
    } catch {
      setLoadError('保管庫の一覧の取得に失敗しました');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(VAULTS_URL);
        if (cancelled) return;
        if (!res.ok) {
          const message = await errorOf(
            res,
            '保管庫の一覧の取得に失敗しました'
          );
          if (cancelled) return;
          setLoadError(message);
          setStatus('error');
          return;
        }
        const data: { vaults: KnowledgeVaultItem[] } = await res.json();
        if (cancelled) return;
        setVaults(data.vaults);
        setStatus('done');
      } catch {
        if (cancelled) return;
        setLoadError('保管庫の一覧の取得に失敗しました');
        setStatus('error');
      }
    }

    void load();
    return () => {
      cancelled = true;
      // ダイアログを閉じたら同期も止める（画面が進めているため）
      abortRef.current?.abort();
    };
  }, []);

  const updateProgress = useCallback(
    (name: string, update: (current: VaultSyncProgress) => VaultSyncProgress) =>
      setProgress((prev) => {
        const current = prev[name];
        return current ? { ...prev, [name]: update(current) } : prev;
      }),
    []
  );

  const syncVault = useCallback(
    async (name: string) => {
      if (abortRef.current) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setSyncingName(name);
      setProgress((prev) => ({
        ...prev,
        [name]: {
          phase: 'planning',
          done: 0,
          total: 0,
          imported: 0,
          removed: 0,
          unchanged: 0,
          failures: [],
          excluded: [],
        },
      }));
      const fail = (error: string) =>
        updateProgress(name, (p) => ({ ...p, phase: 'error', error }));

      try {
        const planRes = await fetch(`${vaultUrl(name)}/plan`, {
          method: 'POST',
          signal: controller.signal,
        });
        if (!planRes.ok) {
          fail(await errorOf(planRes, '差分を求められませんでした'));
          return;
        }
        const plan: VaultSyncPlanResponse = await planRes.json();
        const targets = [
          ...plan.add,
          ...plan.update,
          ...plan.rebuild,
          ...plan.remove,
        ];
        updateProgress(name, (p) => ({
          ...p,
          phase: 'syncing',
          total: targets.length,
          unchanged: plan.unchanged,
          excluded: plan.excluded,
        }));

        for (const target of targets) {
          if (controller.signal.aborted) break;
          const res = await fetch(`${vaultUrl(name)}/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: target }),
            signal: controller.signal,
          });
          if (!res.ok) {
            fail(await errorOf(res, `${target} を同期できませんでした`));
            return;
          }
          const result: { status: VaultFileSyncStatus; error?: string } =
            await res.json();
          updateProgress(name, (p) => ({
            ...p,
            done: p.done + 1,
            imported: p.imported + (result.status === 'imported' ? 1 : 0),
            removed: p.removed + (result.status === 'removed' ? 1 : 0),
            unchanged: p.unchanged + (result.status === 'unchanged' ? 1 : 0),
            failures:
              result.status === 'rejected'
                ? [
                    ...p.failures,
                    { path: target, error: result.error ?? '取り込めません' },
                  ]
                : p.failures,
          }));
        }
        updateProgress(name, (p) => ({
          ...p,
          phase: controller.signal.aborted ? 'stopped' : 'done',
        }));
      } catch {
        if (controller.signal.aborted) {
          updateProgress(name, (p) => ({ ...p, phase: 'stopped' }));
        } else {
          fail('同期に失敗しました');
        }
      } finally {
        abortRef.current = null;
        setSyncingName(null);
        // 止めた・失敗した場合も、済んだ分を一覧の数に出す
        await reload();
      }
    },
    [reload, updateProgress]
  );

  const stopSync = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const deleteVaultIndex = useCallback(
    async (name: string) => {
      setBusyNames((prev) => [...prev, name]);
      setItemErrors((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([key]) => key !== name)
        )
      );
      try {
        const res = await fetch(vaultUrl(name), { method: 'DELETE' });
        if (!res.ok && res.status !== 404) {
          const message = await errorOf(res, '索引の削除に失敗しました');
          setItemErrors((prev) => ({ ...prev, [name]: message }));
          return;
        }
        await reload();
      } catch {
        setItemErrors((prev) => ({
          ...prev,
          [name]: '索引の削除に失敗しました',
        }));
      } finally {
        setBusyNames((prev) => prev.filter((busy) => busy !== name));
      }
    },
    [reload]
  );

  return {
    status,
    vaults,
    loadError,
    progress,
    syncingName,
    busyNames,
    itemErrors,
    syncVault,
    stopSync,
    deleteVaultIndex,
  };
}
