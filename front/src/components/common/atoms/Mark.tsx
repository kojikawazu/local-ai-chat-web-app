import type { ReactNode } from 'react';

/** {@link Mark} の props。 */
type MarkProps = {
  /** 強調する文字列 */
  children: ReactNode;
};

/**
 * 文字列の一部を強調する（共通の atom。#163）。検索のキーワードの一致箇所に使う。
 *
 * @param props - 強調する文字列
 */
export default function Mark({ children }: MarkProps) {
  return (
    <mark className="rounded-sm bg-nord-frost-1/30 px-0.5 text-nord-6">
      {children}
    </mark>
  );
}
