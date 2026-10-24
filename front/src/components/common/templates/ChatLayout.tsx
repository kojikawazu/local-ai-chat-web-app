import type { ReactNode } from 'react';

/** {@link ChatLayout} の props。各領域の中身を受け取る。 */
type ChatLayoutProps = {
  /** デスクトップの左の列（モバイル幅では中身の側で隠す） */
  sidebar: ReactNode;
  /** モバイルのドロワー（開閉と表示条件は中身の側が持つ） */
  drawer: ReactNode;
  /** メイン領域の上端（ヘッダー） */
  header: ReactNode;
  /** メイン領域の本文。残りの高さを使う */
  children: ReactNode;
  /** 本文と入力欄の間に出すお知らせ（エラー等）。省略時・空のときは何も出さない */
  notice?: ReactNode;
  /** 本文の下の入力欄 */
  composer: ReactNode;
  /** メイン領域の下端（フッター） */
  footer: ReactNode;
  /** モーダル等。画面の枠の最後に置く（ネイティブの `<dialog>` は top layer に出るため、位置は見た目に影響しない） */
  dialogs?: ReactNode;
};

/**
 * チャット画面の枠（共通の template。#163）。サイドバー・ドロワーと、メイン領域（ヘッダー・本文・お知らせ・入力欄・フッター）を並べる。
 *
 * 配置・余白だけを持ち、中身は props で受け取る（会話・メッセージなどのドメインは知らない）。
 *
 * @param props - 各領域の中身
 */
export default function ChatLayout({
  sidebar,
  drawer,
  header,
  children,
  notice,
  composer,
  footer,
  dialogs,
}: ChatLayoutProps) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-nord-0 text-nord-6 font-sans">
      {sidebar}
      {drawer}

      <main className="flex-1 flex flex-col relative overflow-hidden">
        {header}
        {children}
        {notice && (
          <div className="px-4 md:px-8 py-2 bg-nord-aurora-red/20 text-nord-aurora-red text-sm text-center">
            {notice}
          </div>
        )}
        {composer}
        {footer}
      </main>

      {dialogs}
    </div>
  );
}
