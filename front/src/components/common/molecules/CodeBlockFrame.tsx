'use client';

import type { ReactNode } from 'react';
import CopyButton from '@/components/common/molecules/CopyButton';

/** {@link CodeBlockFrame} の props。 */
type CodeBlockFrameProps = {
  /** 見出し行に出す言語名。`null` なら出さない */
  language: string | null;
  /** コピーボタンでコピーする文字列（ソースの原文） */
  code: string;
  /** 見出し行のコピーボタンの前に並べる操作（図の切り替え・拡大など）。省略時は出さない */
  actions?: ReactNode;
  /** 本文（ハイライトした `pre`、図など） */
  children: ReactNode;
};

/**
 * コードブロックの枠（共通の molecule。#176）。見出し行（言語名・追加の操作・コピー）と本文を並べる。
 *
 * 言語名と操作は本文の外の見出し行に置き、本文を横スクロールしても重ならない。
 * ホバーの無いスマホでも押せるよう、操作は常に表示する。
 *
 * @param props - 言語名・コピーする文字列・追加の操作・本文を持つ props
 */
export default function CodeBlockFrame({
  language,
  code,
  actions,
  children,
}: CodeBlockFrameProps) {
  return (
    <div className="my-3 rounded-lg bg-nord-0 border border-nord-3 overflow-hidden">
      <div className="flex items-center justify-end gap-3 px-3 py-1.5 border-b border-nord-3 text-xs text-nord-4">
        {language && <span data-testid="code-language">{language}</span>}
        {actions}
        <CopyButton
          text={code}
          label="コードをコピー"
          className="flex-row-reverse"
        />
      </div>
      {children}
    </div>
  );
}
