'use client';

import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { getCodeLanguage, hastToText } from '@/lib/code-block';
import type { HastNode } from '@/lib/code-block';
import { CopyButton } from './CopyButton';

/** {@link MarkdownContent} の props。 */
interface MarkdownContentProps {
  /** 描画対象の Markdown テキスト。 */
  content: string;
}

const components: Components = {
  pre({ children, node }) {
    // react-markdown の hast 型は本ファイルの読み取りに要る部分より広く、構造的にそのまま渡せる
    const pre: HastNode | undefined = node;
    // remark はコードブロックの末尾に改行を 1 つ付けるため、コピー時は落とす
    const code = pre ? hastToText(pre).replace(/\n$/, '') : '';
    const language = pre ? getCodeLanguage(pre) : null;
    return (
      <div className="my-3 rounded-lg bg-nord-0 border border-nord-3 overflow-hidden">
        {/* 言語名とコピーボタンは pre の外の見出し行に置き、横スクロールしても本文と重ならない。
            ホバーの無いスマホでも押せるよう常に表示 */}
        <div className="flex items-center justify-end gap-3 px-3 py-1.5 border-b border-nord-3 text-xs text-nord-4">
          {language && <span data-testid="code-language">{language}</span>}
          <CopyButton
            text={code}
            label="コードをコピー"
            className="flex-row-reverse"
          />
        </div>
        {/* 言語未指定のブロックの code はインライン用の見た目で描画されるため、ここで打ち消す */}
        <pre className="p-4 overflow-x-auto text-sm text-nord-6 [&_code]:p-0 [&_code]:border-0 [&_code]:rounded-none [&_code]:bg-transparent [&_code]:text-inherit">
          {children}
        </pre>
      </div>
    );
  },
  code({ children, className }) {
    // className はコードフェンスに言語を書いたブロックにだけ付く（`hljs language-ts` 等）。
    // rehype-highlight が先頭に hljs を足すため、`language-` で始まるかでは判定しない
    if (className) {
      return <code className={className}>{children}</code>;
    }
    return (
      <code className="px-1.5 py-0.5 rounded bg-nord-0 border border-nord-3 text-nord-frost-1 text-sm">
        {children}
      </code>
    );
  },
  p({ children }) {
    return <p className="mb-3 last:mb-0">{children}</p>;
  },
  ul({ children }) {
    return <ul className="mb-3 pl-6 list-disc space-y-1">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="mb-3 pl-6 list-decimal space-y-1">{children}</ol>;
  },
  li({ children }) {
    return <li>{children}</li>;
  },
  h1({ children }) {
    return (
      <h1 className="text-xl font-bold mb-3 mt-4 first:mt-0">{children}</h1>
    );
  },
  h2({ children }) {
    return (
      <h2 className="text-lg font-bold mb-2 mt-3 first:mt-0">{children}</h2>
    );
  },
  h3({ children }) {
    return (
      <h3 className="text-base font-bold mb-2 mt-3 first:mt-0">{children}</h3>
    );
  },
  blockquote({ children }) {
    return (
      <blockquote className="border-l-4 border-nord-frost-1 pl-4 my-3 text-nord-4">
        {children}
      </blockquote>
    );
  },
  table({ children }) {
    return (
      <div className="my-3 overflow-x-auto">
        <table className="w-full border-collapse border border-nord-3 text-sm">
          {children}
        </table>
      </div>
    );
  },
  th({ children }) {
    return (
      <th className="border border-nord-3 px-3 py-2 bg-nord-0 text-left font-bold">
        {children}
      </th>
    );
  },
  td({ children }) {
    return <td className="border border-nord-3 px-3 py-2">{children}</td>;
  },
  a({ children, href }) {
    return (
      <a
        href={href}
        className="text-nord-frost-1 underline hover:text-nord-frost-2"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    );
  },
  hr() {
    return <hr className="my-4 border-nord-3" />;
  },
};

/**
 * Markdown テキストを Nord テーマ準拠のスタイルで描画する。
 *
 * `remark-gfm` で GFM（表・打ち消し線等）に対応し、各要素をテーマ色付きの
 * カスタムコンポーネントで描画する。HTML はパースせず React の標準エスケープに
 * 委ねるため、XSS 耐性を保つ。コードブロックは `rehype-highlight` で言語別に色付けし
 * （色は `globals.css` の `.hljs-*`）、右上に言語名とコピーボタンを付ける。言語の指定が
 * 無いブロックは自動判定せず単色のまま描画する。
 *
 * @param props - 描画する Markdown テキストを持つ props
 */
export default function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <div className="leading-relaxed text-sm md:text-base prose-nord">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
