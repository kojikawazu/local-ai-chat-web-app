'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { CopyButton } from './CopyButton';

/** {@link MarkdownContent} の props。 */
interface MarkdownContentProps {
  /** 描画対象の Markdown テキスト。 */
  content: string;
}

/** 構文木（hast）のうち、文字列の取り出しに使う部分だけの形 */
type HastNode = { type: string; value?: string; children?: HastNode[] };

/**
 * 構文木のノード配下の文字列を連結して返す（DOM の `textContent` 相当）。
 *
 * @param node - 対象のノード
 * @returns 配下のテキストノードの値を順に連結した文字列
 */
function hastToText(node: HastNode): string {
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(hastToText).join('');
}

const components: Components = {
  pre({ children, node }) {
    // remark はコードブロックの末尾に改行を 1 つ付けるため、コピー時は落とす
    const code = node ? hastToText(node).replace(/\n$/, '') : '';
    return (
      <div className="relative my-3">
        <pre className="p-4 rounded-lg bg-nord-0 border border-nord-3 overflow-x-auto text-sm">
          {children}
        </pre>
        {/* pre の外に置き、横スクロールしても右上に留める。ホバーの無いスマホでも押せるよう常に表示 */}
        <CopyButton
          text={code}
          label="コードをコピー"
          className="absolute top-2 right-2 flex-row-reverse px-2 py-1 rounded bg-nord-1/80 text-xs text-nord-4"
        />
      </div>
    );
  },
  code({ children, className }) {
    const isBlock = className?.startsWith('language-');
    if (isBlock) {
      return <code className={`${className} text-nord-6`}>{children}</code>;
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
 * 委ねるため、XSS 耐性を保つ。コードブロックには右上にコピーボタンを付ける。
 *
 * @param props - 描画する Markdown テキストを持つ props
 */
export default function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <div className="leading-relaxed text-sm md:text-base prose-nord">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
