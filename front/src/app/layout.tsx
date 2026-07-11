import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

/**
 * アプリ全体のメタデータ（ページタイトル・説明）。Next.js が `<head>` に反映する。
 */
export const metadata: Metadata = {
  title: 'Nordic Chat',
  description: 'ローカルLLMと対話するチャットアプリケーション',
};

/**
 * 全ページ共通のルートレイアウト。`<html>` / `<body>` とフォント変数を定義する。
 *
 * @param props - レイアウトの props
 * @param props.children - 各ページの内容としてレンダリングされる子要素
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
