import type {
  Element,
  ElementContent,
  Properties,
  Root,
  RootContent,
} from 'hast';
import { toHtml } from 'hast-util-to-html';
import { defaultUrlTransform } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { getCodeLanguage, hastToText } from '@/lib/chat/code-block';
import type { HastNode } from '@/lib/chat/code-block';
import { getDiagramKind } from '@/lib/chat/diagram';
import {
  formatDateTime,
  normalizeTitle,
  ROLE_HEADINGS,
} from '@/lib/chat/export';
import { REPORT_STYLE } from '@/lib/chat/report-style';
import { getRoleLabel } from '@/lib/chat/system-prompt';
import type { DiagramKind } from '@/types/chat/diagram';
import type { Message } from '@/types/chat/message';

/**
 * HTML のレポート（#36。`docs/24-html-report-export.md`）を組み立てる純関数群。
 *
 * Markdown は画面と同じ remark-gfm・rehype-highlight で構文木（hast）にし、`hast-util-to-html` で文字列にする
 * （HTML を文字列の連結で作らない。エスケープを取りこぼさないため）。本文の生の HTML はテキストとして出し、
 * 危ない URL のリンクは外し、本文の画像は埋め込まずにリンクにする。図は、呼び出し側が描いた SVG（`data:` URI）を
 * `<img>` で入れ、描けなかった図はソースのコードブロックのまま残す。
 */

/** レポートに入れる図（Markdown の中の mermaid・plantuml のコードブロック）。 */
export type ReportDiagram = {
  /** 図の種類 */
  kind: DiagramKind;
  /** 図のソース（末尾の改行を除く。画面の表示と同じ） */
  source: string;
};

/** {@link renderMarkdown} の変換の指定。 */
export type RenderOptions = {
  /**
   * コメントだけの生の HTML（`<!-- … -->`）を出さない（スライド。Marp の指示・発表者のノートの書き方を文字で出さないため）。
   * 既定（false）は、ほかの生の HTML と同じく文字として出す
   */
  dropHtmlComments?: boolean;
};

/** 描けた図。キーは {@link diagramKey}、値は SVG の `data:` URI */
export type RenderedDiagrams = ReadonlyMap<string, string>;

/** レポートに入れる添付画像。読めなかった画像は `null`（注記を出す） */
export type ReportImage = {
  /** 画像の `data:` URI（`data:image/png;base64,…` か `data:image/jpeg;base64,…`） */
  dataUri: string;
  /** 幅（px） */
  width: number;
  /** 高さ（px） */
  height: number;
} | null;

/** レポートに入れる 1 件のメッセージ。 */
export type ReportMessage = Pick<Message, 'role' | 'content' | 'createdAt'> & {
  /** 生成を中断した応答か */
  interrupted: boolean;
  /** 添付画像（user のメッセージだけ。並び順のまま） */
  images: ReportImage[];
};

/** レポートの中身。 */
export type ReportInput = {
  /** `conversation` は会話全体（見出し付きでメッセージを並べる）、`message` は応答 1 件（本文だけ） */
  mode: 'conversation' | 'message';
  /** 会話のタイトル */
  title: string;
  /** 書き出した日時 */
  exportedAt: Date;
  /** 会話の役割（システムプロンプト）。会話全体のときだけ出す。無ければ `null` */
  systemPrompt: string | null;
  /** メッセージ（古い順） */
  messages: ReportMessage[];
};

/** 埋め込んでよい添付画像の `data:` URI（PNG・JPEG の Base64 だけ） */
const IMAGE_DATA_URI = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+=*$/;

/**
 * 図を引くキーを作る（同じ種類・同じソースの図は 1 回だけ描く）。
 *
 * @param kind - 図の種類
 * @param source - 図のソース
 * @returns キー
 */
export function diagramKey(kind: DiagramKind, source: string): string {
  return `${kind}\n${source}`;
}

/**
 * hast の要素を作る。
 *
 * @param tagName - タグ名
 * @param properties - 属性
 * @param children - 子
 * @returns 要素
 */
export function el(
  tagName: string,
  properties: Properties = {},
  children: ElementContent[] = []
): Element {
  return { type: 'element', tagName, properties, children };
}

/**
 * hast のテキストを作る（値は `hast-util-to-html` がエスケープする）。
 *
 * @param value - 文字列
 * @returns テキストのノード
 */
export function text(value: string): ElementContent {
  return { type: 'text', value };
}

/**
 * Markdown を hast にする（remark-parse → remark-gfm → remark-rehype）。
 *
 * 生の HTML は react-markdown と同じく、構文木に `raw` として入れてからテキストに替える（そのままの文字で見せる）。
 *
 * @param markdown - Markdown の本文
 * @param dropHtmlComments - コメントだけの生の HTML を出さないか（{@link RenderOptions}）
 * @returns hast のルート
 */
function markdownToHast(markdown: string, dropHtmlComments: boolean): Root {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true });
  const tree = processor.runSync(processor.parse(markdown)) as Root;
  replaceRawWithText(tree, dropHtmlComments);
  return tree;
}

/** HTML のコメント（`<!-- … -->`） */
const HTML_COMMENT = /<!--[\s\S]*?-->/g;

/**
 * 生の HTML が、コメントと空白だけでできているかを判定する。
 *
 * @param value - 生の HTML
 * @returns コメントだけなら true
 */
function isCommentOnly(value: string): boolean {
  return (
    value.includes('<!--') && value.replace(HTML_COMMENT, '').trim() === ''
  );
}

/**
 * 生の HTML（`raw` のノード）をテキストのノードに替える（スクリプト等をタグとして出さない）。
 *
 * @param node - 走査する親
 * @param dropHtmlComments - true ならコメントだけの生の HTML は替えずに取り除く
 */
function replaceRawWithText(
  node: Root | Element,
  dropHtmlComments: boolean
): void {
  node.children = node.children.flatMap((child) => {
    if (child.type === 'raw') {
      if (dropHtmlComments && isCommentOnly(child.value)) return [];
      return [{ type: 'text', value: child.value }];
    }
    if (child.type === 'element') replaceRawWithText(child, dropHtmlComments);
    return [child];
  }) as typeof node.children;
}

/**
 * hast の中のコードブロック（`<pre><code>`）のうち、図として描くものを探す。
 *
 * @param pre - `pre` の要素
 * @returns 図。図でなければ `null`
 */
function diagramOf(pre: Element): ReportDiagram | null {
  // code-block.ts の読み取りは、hast の型の一部だけを持つ形（HastNode）で受ける。hast の要素はその形を満たす
  const node = pre as unknown as HastNode;
  const kind = getDiagramKind(getCodeLanguage(node));
  if (!kind) return null;
  return { kind, source: hastToText(node).replace(/\n$/, '') };
}

/**
 * hast を深さ優先でたどり、要素ごとに関数を呼ぶ。
 *
 * @param node - たどり始める親
 * @param visit - 要素ごとに呼ぶ関数
 */
function walk(node: Root | Element, visit: (element: Element) => void): void {
  for (const child of node.children) {
    if (child.type === 'element') {
      visit(child);
      walk(child, visit);
    }
  }
}

/**
 * Markdown の本文から、レポートに描いて入れる図を拾う（同じ種類・同じソースは 1 つにまとめる）。
 *
 * @param markdowns - Markdown の本文（応答ごと）
 * @returns 図（現れた順）
 */
export function collectDiagrams(markdowns: string[]): ReportDiagram[] {
  const found = new Map<string, ReportDiagram>();
  for (const markdown of markdowns) {
    walk(markdownToHast(markdown, false), (element) => {
      if (element.tagName !== 'pre') return;
      const diagram = diagramOf(element);
      if (diagram && diagram.source.trim() !== '') {
        found.set(diagramKey(diagram.kind, diagram.source), diagram);
      }
    });
  }
  return [...found.values()];
}

/**
 * 描けた図のコードブロックを `<img>`（図の `data:` URI）に置き換える。描けなかった図はそのまま残す。
 *
 * @param node - 走査する親
 * @param diagrams - 描けた図
 */
function replaceDiagrams(
  node: Root | Element,
  diagrams: RenderedDiagrams
): void {
  node.children = node.children.map((child) => {
    if (child.type !== 'element') return child;
    if (child.tagName === 'pre') {
      const diagram = diagramOf(child);
      const src =
        diagram && diagrams.get(diagramKey(diagram.kind, diagram.source));
      if (diagram && src) {
        return el('figure', { className: [DIAGRAM_FIGURE_CLASS] }, [
          el('img', { src, alt: `${diagram.kind} の図` }),
        ]);
      }
      return child;
    }
    replaceDiagrams(child, diagrams);
    return child;
  }) as typeof node.children;
}

/** 描けた図を入れる要素のクラス */
const DIAGRAM_FIGURE_CLASS = 'diagram';

/**
 * 要素が、描けた図を入れた figure（{@link replaceDiagrams} が作ったもの）かを判定する。
 *
 * @param element - 要素
 * @returns 図の figure なら true
 */
function isDiagramFigure(element: Element): boolean {
  const className = element.properties.className;
  return (
    element.tagName === 'figure' &&
    Array.isArray(className) &&
    className.includes(DIAGRAM_FIGURE_CLASS)
  );
}

/**
 * リンクの URL を react-markdown と同じ判定で検査し、本文の画像をリンクに置き換える。
 *
 * - `a`: 危ない URL（`javascript:` 等）なら `href` を外して文字だけにする
 * - `img`: 埋め込まない（ファイルを開いたときに外部へ読みに行かせない）。安全な URL なら代替テキストのリンク、
 *   そうでなければ代替テキストだけにする
 *
 * @param node - 走査する親
 */
function sanitizeLinksAndImages(node: Root | Element): void {
  node.children = node.children.map((child) => {
    if (child.type !== 'element') return child;
    // 描けた図（replaceDiagrams が作った figure）の img は、こちらで描いた data: URI なので外さない。
    // 本文の Markdown から figure は作られない（生の HTML は文字にしている）
    if (isDiagramFigure(child)) return child;
    if (child.tagName === 'img') {
      const src =
        typeof child.properties.src === 'string' ? child.properties.src : '';
      const alt =
        typeof child.properties.alt === 'string' && child.properties.alt
          ? child.properties.alt
          : '画像';
      const safe = src ? defaultUrlTransform(src) : '';
      return safe
        ? el('a', { href: safe }, [text(`［画像: ${alt}］`)])
        : text(`［画像: ${alt}］`);
    }
    if (child.tagName === 'a') {
      const href =
        typeof child.properties.href === 'string' ? child.properties.href : '';
      const safe = href ? defaultUrlTransform(href) : '';
      if (safe) {
        child.properties = { ...child.properties, href: safe };
      } else {
        delete child.properties.href;
      }
    }
    sanitizeLinksAndImages(child);
    return child;
  }) as typeof node.children;
}

/**
 * Markdown を、レポートに入れる HTML の要素（hast）にする。
 *
 * 順序: 図の置き換え（描けた図だけ）→ コードの色付け（rehype-highlight。画面と同じ）→ リンク・画像の検査。
 * 図を先に置き換えるのは、図のソースに色付けのタグを入れないため。
 *
 * @param markdown - Markdown の本文
 * @param diagrams - 描けた図
 * @param options - 変換の指定（省略時は HTML レポートの既定）
 * @returns 本文の要素
 */
export function renderMarkdown(
  markdown: string,
  diagrams: RenderedDiagrams,
  options: RenderOptions = {}
): ElementContent[] {
  const tree = markdownToHast(markdown, options.dropHtmlComments === true);
  replaceDiagrams(tree, diagrams);
  const highlighted = unified().use(rehypeHighlight).runSync(tree) as Root;
  sanitizeLinksAndImages(highlighted);
  return highlighted.children.filter(
    (child): child is ElementContent => child.type !== 'doctype'
  );
}

/**
 * 添付画像を並べる要素にする。読めなかった画像・形の合わない `data:` URI は注記にする。
 *
 * @param images - 添付画像
 * @returns 画像を並べる要素
 */
function renderImages(images: ReportImage[]): Element {
  return el(
    'div',
    { className: ['images'] },
    images.map((image) =>
      image && IMAGE_DATA_URI.test(image.dataUri)
        ? el('img', {
            src: image.dataUri,
            width: image.width,
            height: image.height,
            alt: '添付画像',
          })
        : el('p', { className: ['note'] }, [
            text('（画像を読み込めませんでした）'),
          ])
    )
  );
}

/**
 * 1 件のメッセージの本文の要素にする。user は文字のまま（改行を保つ）、assistant は Markdown として整形する。
 *
 * @param message - メッセージ
 * @param diagrams - 描けた図
 * @returns 本文の要素
 */
function renderBody(
  message: ReportMessage,
  diagrams: RenderedDiagrams
): ElementContent[] {
  const body: ElementContent[] = [];
  if (message.images.length > 0) body.push(renderImages(message.images));
  body.push(
    message.role === 'user'
      ? el('p', { className: ['plain'] }, [text(message.content)])
      : el(
          'div',
          { className: ['markdown'] },
          renderMarkdown(message.content, diagrams)
        )
  );
  if (message.interrupted) {
    body.push(
      el('p', { className: ['note'] }, [text('（生成を中断した応答）')])
    );
  }
  return body;
}

/**
 * レポートの HTML の文書を組み立てる（1 ファイルで完結する。CSS を埋め込み、スクリプトは入れない）。
 *
 * 会話全体: タイトル・書き出した日時・会話の役割と、メッセージを「ユーザー / アシスタント（日時）」の見出しで並べる。
 * 応答 1 件: タイトルと「アシスタント（日時）」の下に、その応答の本文だけを置く。
 * 思考過程・ツールの結果は入れない（Markdown の書き出しと同じ）。
 *
 * @param input - レポートの中身
 * @param diagrams - 描けた図（キーは {@link diagramKey}）
 * @returns `<!doctype html>` で始まる HTML の文字列
 */
export function buildReportHtml(
  input: ReportInput,
  diagrams: RenderedDiagrams
): string {
  const title = normalizeTitle(input.title);
  const header: ElementContent[] = [
    el('h1', {}, [text(title)]),
    el('p', { className: ['meta'] }, [
      text(`書き出した日時: ${formatDateTime(input.exportedAt)}`),
    ]),
  ];
  const role = input.systemPrompt?.trim();
  if (input.mode === 'conversation' && role) {
    header.push(
      el('p', { className: ['meta'] }, [
        text(`会話の役割: ${getRoleLabel(role)}`),
      ]),
      el('blockquote', { className: ['role'] }, [text(role)])
    );
  }

  const sections = input.messages.map((message) =>
    el('section', { className: ['message', message.role] }, [
      el('h2', {}, [
        text(
          `${ROLE_HEADINGS[message.role]}（${formatDateTime(message.createdAt)}）`
        ),
      ]),
      ...renderBody(message, diagrams),
    ])
  );

  const doc: Root = {
    type: 'root',
    children: [
      { type: 'doctype' },
      el('html', { lang: 'ja' }, [
        el('head', {}, [
          el('meta', { charSet: 'utf-8' }),
          el('meta', {
            name: 'viewport',
            content: 'width=device-width, initial-scale=1',
          }),
          el('title', {}, [text(title)]),
          el('style', {}, [text(REPORT_STYLE)]),
        ]),
        el('body', {}, [
          el('main', {}, [el('header', {}, header), ...sections]),
        ]),
      ]),
    ] as RootContent[],
  };
  return `${toHtml(doc)}\n`;
}
