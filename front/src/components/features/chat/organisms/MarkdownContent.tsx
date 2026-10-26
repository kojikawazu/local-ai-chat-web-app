'use client';

import { createContext, use } from 'react';
import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { getCodeLanguage, hastToText } from '@/lib/chat/code-block';
import type { HastNode } from '@/lib/chat/code-block';
import { getDiagramKind } from '@/lib/chat/diagram';
import { cn } from '@/lib/shared/class-names';
import CodeBlockFrame from '@/components/common/molecules/CodeBlockFrame';
import DiagramView from '@/components/features/chat/molecules/DiagramView';
import { useMermaidDiagram } from '@/hooks/chat/useMermaidDiagram';
import { usePlantUmlDiagram } from '@/hooks/chat/usePlantUmlDiagram';

/** {@link MarkdownContent} の props。 */
interface MarkdownContentProps {
  /** 描画対象の Markdown テキスト。 */
  content: string;
  /** 応答の生成中か。生成中は図（Mermaid・PlantUML）を描かず、ソースのまま表示する（#169・#171）。省略時は `false`。 */
  isStreaming?: boolean;
  /**
   * 文字の大きさ。`default` は回答の本文、`compact` はエージェントのツールの前の説明など
   * 回答と見分けたい補助の本文（小さく薄く出す。#186）。省略時は `default`
   */
  size?: MarkdownSize;
}

/** {@link MarkdownContent} の文字の大きさの種類。 */
type MarkdownSize = 'default' | 'compact';

const SIZE_CLASSES: Record<MarkdownSize, string> = {
  default: 'text-sm md:text-base',
  compact: 'text-xs md:text-sm text-nord-4/80',
};

/**
 * 生成中かを `components.pre` に届ける。`components` を描画のたびに作り直すと React が別の
 * コンポーネントとみなし、図を毎回作り直して描き直すため、props ではなく Context で渡す
 */
const StreamingContext = createContext(false);

const components: Components = {
  pre({ children, node }) {
    // react-markdown の hast 型は本ファイルの読み取りに要る部分より広く、構造的にそのまま渡せる
    const pre: HastNode | undefined = node;
    // remark はコードブロックの末尾に改行を 1 つ付けるため、コピー時は落とす
    const code = pre ? hastToText(pre).replace(/\n$/, '') : '';
    const language = pre ? getCodeLanguage(pre) : null;
    const diagramKind = getDiagramKind(language);
    const body = (
      // 言語未指定のブロックの code はインライン用の見た目で描画されるため、ここで打ち消す
      <pre className="p-4 overflow-x-auto text-sm text-nord-6 [&_code]:p-0 [&_code]:border-0 [&_code]:rounded-none [&_code]:bg-transparent [&_code]:text-inherit">
        {children}
      </pre>
    );
    // 図の種類が決まるのは言語名がある場合だけ
    if (diagramKind === 'mermaid' && language) {
      return (
        <MermaidCodeBlock source={code} language={language} fallback={body} />
      );
    }
    if (diagramKind === 'plantuml' && language) {
      return (
        <PlantUmlCodeBlock source={code} language={language} fallback={body} />
      );
    }
    return (
      <CodeBlockFrame language={language} code={code}>
        {body}
      </CodeBlockFrame>
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

/** 図のコードブロック（{@link MermaidCodeBlock}・{@link PlantUmlCodeBlock}）の props。 */
type DiagramCodeBlockProps = {
  /** 図のソース（コピーするソースの原文でもある）。 */
  source: string;
  /** 見出し行に出す言語名（コードフェンスに書かれたまま）。 */
  language: string;
  /** ソースのコードブロック（図を描けるまで・描けなかったとき・ソースへ切り替えたときの表示）。 */
  fallback: ReactNode;
};

/**
 * Mermaid のコードブロックの本文を、生成中かを Context から読んで図にする（#169）。
 *
 * 描画のフックは organisms に置き、表示は {@link DiagramView}（molecules）に任せる（`docs/12` の階層の判断基準）。
 *
 * @param props - Mermaid のソース・言語名と、ソースのコードブロックを持つ props
 */
function MermaidCodeBlock({
  source,
  language,
  fallback,
}: DiagramCodeBlockProps) {
  const isStreaming = use(StreamingContext);
  const diagram = useMermaidDiagram(source, !isStreaming);
  return (
    <DiagramView
      diagram={diagram}
      kind="mermaid"
      language={language}
      code={source}
      fallback={fallback}
    />
  );
}

/**
 * PlantUML のコードブロックの本文を、生成中かを Context から読んで図にする（#171）。
 *
 * @param props - PlantUML のソース・言語名と、ソースのコードブロックを持つ props
 */
function PlantUmlCodeBlock({
  source,
  language,
  fallback,
}: DiagramCodeBlockProps) {
  const isStreaming = use(StreamingContext);
  const diagram = usePlantUmlDiagram(source, !isStreaming);
  return (
    <DiagramView
      diagram={diagram}
      kind="plantuml"
      language={language}
      code={source}
      fallback={fallback}
    />
  );
}

/**
 * Markdown テキストを Nord テーマ準拠のスタイルで描画する。
 *
 * `remark-gfm` で GFM（表・打ち消し線等）に対応し、各要素をテーマ色付きの
 * カスタムコンポーネントで描画する。HTML はパースせず React の標準エスケープに
 * 委ねるため、XSS 耐性を保つ。コードブロックは `rehype-highlight` で言語別に色付けし
 * （色は `globals.css` の `.hljs-*`）、見出し行に言語名とコピーボタンを付ける（`CodeBlockFrame`）。言語の指定が
 * 無いブロックは自動判定せず単色のまま描画する。`mermaid`・`plantuml` のブロックは図として描く（生成中はソースのまま）。描けた図は拡大・保存・ソースとの切り替えができる（#176）。
 *
 * @param props - 描画する Markdown テキストと、生成中か・文字の大きさを持つ props
 */
export default function MarkdownContent({
  content,
  isStreaming = false,
  size = 'default',
}: MarkdownContentProps) {
  return (
    <div className={cn('leading-relaxed prose-nord', SIZE_CLASSES[size])}>
      <StreamingContext value={isStreaming}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={components}
        >
          {content}
        </ReactMarkdown>
      </StreamingContext>
    </div>
  );
}
