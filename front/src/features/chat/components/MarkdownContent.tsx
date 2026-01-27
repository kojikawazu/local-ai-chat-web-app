'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

interface MarkdownContentProps {
  content: string;
}

const components: Components = {
  pre({ children }) {
    return (
      <pre className="my-3 p-4 rounded-lg bg-nord-0 border border-nord-3 overflow-x-auto text-sm">
        {children}
      </pre>
    );
  },
  code({ children, className }) {
    const isBlock = className?.startsWith('language-');
    if (isBlock) {
      return (
        <code className={`${className} text-nord-6`}>{children}</code>
      );
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
    return <h1 className="text-xl font-bold mb-3 mt-4 first:mt-0">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="text-lg font-bold mb-2 mt-3 first:mt-0">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="text-base font-bold mb-2 mt-3 first:mt-0">{children}</h3>;
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
    return (
      <td className="border border-nord-3 px-3 py-2">{children}</td>
    );
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

export default function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <div className="leading-relaxed text-sm md:text-base prose-nord">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
