'use client';

import { Copy, Check, TriangleAlert } from 'lucide-react';
import { useCopyFeedback } from '../hooks/useCopyFeedback';

/** {@link CopyButton} の props。 */
type CopyButtonProps = {
  /** クリック時にコピーする文字列。 */
  text: string;
  /** ボタンのアクセシブルネーム（例: 「コピー」「コードをコピー」）。結果の表示中も変えない。 */
  label: string;
  /** 外側の要素に足すクラス（配置の指定など）。 */
  className?: string;
};

/**
 * クリックで文字列をクリップボードへコピーし、結果を一時的に表示するボタン。
 *
 * 成功時はアイコンを Check に替えて「コピーしました」、失敗時は TriangleAlert と
 * 「コピーに失敗しました」を表示し、一定時間後に元へ戻す。結果の文言は
 * `role="status"` で読み上げられる（領域は常に置き、文言だけを差し替える）。
 *
 * @param props - コピーする文字列・ボタン名・配置用クラスを持つ props
 */
export function CopyButton({ text, label, className = '' }: CopyButtonProps) {
  const { status, copy } = useCopyFeedback();

  return (
    <span className={`inline-flex items-center ${className}`}>
      <button
        type="button"
        className="hover:text-nord-frost-1 transition-colors"
        onClick={() => copy(text)}
        aria-label={label}
      >
        {status === 'copied' ? (
          <Check size={14} className="text-nord-aurora-green" />
        ) : status === 'failed' ? (
          <TriangleAlert size={14} className="text-nord-aurora-red" />
        ) : (
          <Copy size={14} />
        )}
      </button>
      {/* 余白は表示中だけ付ける。空のときに幅を持つと、隣の要素（時刻表示など）がずれる */}
      <span
        role="status"
        className={
          status === 'idle'
            ? ''
            : status === 'failed'
              ? 'px-1 text-nord-aurora-red'
              : 'px-1 text-nord-aurora-green'
        }
      >
        {status === 'copied'
          ? 'コピーしました'
          : status === 'failed'
            ? 'コピーに失敗しました'
            : ''}
      </span>
    </span>
  );
}
