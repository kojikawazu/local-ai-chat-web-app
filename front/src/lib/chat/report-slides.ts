import type { ElementContent, Root, RootContent } from 'hast';
import { toHtml } from 'hast-util-to-html';
import { normalizeTitle } from '@/lib/chat/export';
import type { RenderedDiagrams } from '@/lib/chat/report-html';
import { el, renderMarkdown, text } from '@/lib/chat/report-html';
import type { SlideBlockKind } from '@/lib/chat/slides';
import { splitSlides, stripFrontMatter } from '@/lib/chat/slides';
import { SLIDES_STYLE } from '@/lib/chat/slides-style';

/**
 * 応答の HTML スライド（#36。`docs/26-html-slides-export.md`）を組み立てる純関数群。
 *
 * 本文は HTML レポートと同じ {@link renderMarkdown}（図の置き換え・コードの色付け・URL の検査・生の HTML は文字）で
 * 要素の並びにし、`splitSlides` でスライドに分ける。HTML レポートと同じく、構文木（hast）から文字列にし、
 * スクリプトは入れない（ページ送りは CSS の scroll-snap）。
 */

/** スライドにする応答。 */
export type SlidesInput = {
  /** 会話のタイトル（`<title>`・各スライドの下・本文が空のときの表紙） */
  title: string;
  /** 応答の本文（Markdown） */
  content: string;
  /** 生成を中断した応答か（最後のスライドに注記を付ける） */
  interrupted: boolean;
};

/** 見出しの要素のタグ名と段階 */
const HEADING_TAG = /^h([1-6])$/;

/**
 * hast の最上位の子を、スライドの分け方から見た種類にする。
 *
 * @param node - 本文の最上位の子
 * @returns ブロックの種類
 */
function kindOfHast(node: ElementContent): SlideBlockKind {
  if (node.type === 'text') {
    return node.value.trim() === '' ? { type: 'blank' } : { type: 'other' };
  }
  if (node.type !== 'element') return { type: 'blank' };
  if (node.tagName === 'hr') return { type: 'rule' };
  if (node.tagName === 'p') return { type: 'paragraph' };
  const heading = HEADING_TAG.exec(node.tagName);
  return heading
    ? { type: 'heading', depth: Number(heading[1]) }
    : { type: 'other' };
}

/**
 * 応答の HTML スライドの文書を組み立てる（1 ファイルで完結する。CSS を埋め込み、スクリプトは入れない）。
 *
 * 本文の先頭の front matter と、コメントだけの生の HTML（Marp の指示・発表者のノート）は出さない。
 * 各スライドの下に会話のタイトルとページ番号（`n / 全体`）を書き込む。本文が空なら会話のタイトルの表紙を 1 枚にする。
 *
 * @param input - スライドにする応答
 * @param diagrams - 描けた図（キーは `diagramKey`。描けなかった図はソースのコードブロックのまま）
 * @returns `<!doctype html>` で始まる HTML の文字列
 */
export function buildSlidesHtml(
  input: SlidesInput,
  diagrams: RenderedDiagrams
): string {
  const title = normalizeTitle(input.title);
  const body = renderMarkdown(stripFrontMatter(input.content), diagrams, {
    dropHtmlComments: true,
  });
  const split = splitSlides(body, kindOfHast);
  const slides =
    split.length > 0
      ? split
      : [{ blocks: [el('h1', {}, [text(title)])], cover: true }];

  const sections = slides.map((slide, index) => {
    const blocks = [...slide.blocks];
    if (input.interrupted && index === slides.length - 1) {
      blocks.push(
        el('p', { className: ['note'] }, [text('（生成を中断した応答）')])
      );
    }
    return el(
      'section',
      {
        className: slide.cover ? ['slide', 'cover'] : ['slide'],
        id: `slide-${index + 1}`,
      },
      [
        el('div', { className: ['slide-body', 'markdown'] }, blocks),
        el('footer', { className: ['slide-footer'] }, [
          el('span', { className: ['slide-title'] }, [text(title)]),
          el('span', { className: ['slide-number'] }, [
            text(`${index + 1} / ${slides.length}`),
          ]),
        ]),
      ]
    );
  });

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
          el('style', {}, [text(SLIDES_STYLE)]),
        ]),
        el('body', {}, [el('main', {}, sections)]),
      ]),
    ] as RootContent[],
  };
  return `${toHtml(doc)}\n`;
}
