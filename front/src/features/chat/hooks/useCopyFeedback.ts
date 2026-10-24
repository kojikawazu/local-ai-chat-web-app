import { useEffect, useRef, useState } from 'react';
import { copyText } from '@/lib/chat/clipboard';

/** コピー結果の表示を元に戻すまでの時間（ms）。読み取れて、次の操作の邪魔にならない長さ */
const COPY_FEEDBACK_RESET_MS = 2000;

/** コピーボタンの表示状態。`idle` は通常、`copied` / `failed` は結果の表示中 */
type CopyStatus = 'idle' | 'copied' | 'failed';

/**
 * クリップボードへのコピーと、その結果の一時表示を管理する。
 *
 * コピー後は `status` が `copied`（失敗時は `failed`）になり、
 * {@link COPY_FEEDBACK_RESET_MS} 後に `idle` へ戻る。表示中に再度コピーすると、
 * 戻すまでの時間を延長する。
 *
 * @returns 現在の表示状態と、コピーを実行する関数
 */
export function useCopyFeedback(): {
  status: CopyStatus;
  copy: (text: string) => Promise<void>;
} {
  const [status, setStatus] = useState<CopyStatus>('idle');
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 表示中にアンマウントされても、戻すタイマーが残らないようにする
  useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    []
  );

  const copy = async (text: string) => {
    let next: CopyStatus;
    try {
      await copyText(text);
      next = 'copied';
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      next = 'failed';
    }
    setStatus(next);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(
      () => setStatus('idle'),
      COPY_FEEDBACK_RESET_MS
    );
  };

  return { status, copy };
}
