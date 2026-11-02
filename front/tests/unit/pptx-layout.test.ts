import { describe, it, expect } from 'vitest';
import type { DiagramImages, DocImage } from '@/lib/chat/document-model';
import type {
  PptxDeck,
  PptxParagraph,
  PptxShape,
  PptxSlide,
} from '@/lib/chat/pptx-layout';
import { kindOfDocBlock, layoutPptx } from '@/lib/chat/pptx-layout';
import { diagramKey } from '@/lib/chat/report-html';

/**
 * PPTX の割り付け（#36。`docs/27-pptx-export.md`「スライドの割り付け」）の UT。外部 I/O が無いため mock は使わない。
 *
 * 分け方は HTML スライドと共通の `splitSlides`（`slides.test.ts`）で確かめているため、ここでは文書の中間の形からの
 * 分け方・タイトル・表紙と、図形の位置（本文の枠に収まり、重ならない）・続きのスライドを確かめる。
 */

/** 本文の枠の上端（タイトルあり / なし）・下端と幅（インチ。`pptx-layout.ts` と同じ値） */
const BODY = {
  topWithTitle: 1.6,
  topWithoutTitle: 0.5,
  bottom: 6.7,
  left: 0.6,
  width: 13.333 - 1.2,
} as const;

/** 小数の誤差の許し */
const EPS = 1e-6;

/** 図のない応答の割り付け */
const NO_DIAGRAMS: DiagramImages = new Map();

/**
 * 応答を割り付ける。
 *
 * @param content - 応答の Markdown
 * @param options - 会話のタイトル・中断・描けた図
 * @returns 割り付け
 */
const layout = (
  content: string,
  options: {
    title?: string;
    interrupted?: boolean;
    diagrams?: DiagramImages;
  } = {}
): PptxDeck =>
  layoutPptx(
    {
      title: options.title ?? '旅行の計画',
      content,
      interrupted: options.interrupted ?? false,
    },
    options.diagrams ?? NO_DIAGRAMS
  );

/**
 * 本文のスライドだけを取り出す（表紙なら失敗させる）。
 *
 * @param slide - スライド
 * @returns 本文のスライド
 */
function content(slide: PptxSlide | undefined) {
  if (slide?.kind !== 'content') throw new Error('not a content slide');
  return slide;
}

/**
 * 図形のテキストを、段落ごとの文字列にする。
 *
 * @param shape - 図形
 * @returns 段落ごとの文字列（テキストのない図形は空）
 */
function texts(shape: PptxShape): string[] {
  if (shape.type !== 'text' && shape.type !== 'quote') return [];
  return shape.paragraphs.map(paragraphText);
}

/**
 * 段落の文字列（改行は `\n`）。
 *
 * @param paragraph - 段落
 * @returns 文字列
 */
function paragraphText(paragraph: PptxParagraph): string {
  return paragraph.runs
    .map((run) => (run.type === 'break' ? '\n' : run.text))
    .join('');
}

/**
 * 本文のスライドの図形が、本文の枠に収まり、上から順に重ならずに並ぶことを確かめる。
 *
 * @param deck - 割り付け
 */
function expectInsideBody(deck: PptxDeck): void {
  for (const slide of deck.slides) {
    if (slide.kind !== 'content') continue;
    const top = slide.title ? BODY.topWithTitle : BODY.topWithoutTitle;
    let previousBottom = top;
    for (const { rect } of slide.shapes) {
      expect(rect.y).toBeGreaterThanOrEqual(previousBottom - EPS);
      expect(rect.y + rect.h).toBeLessThanOrEqual(BODY.bottom + EPS);
      expect(rect.x).toBeGreaterThanOrEqual(BODY.left - EPS);
      expect(rect.x + rect.w).toBeLessThanOrEqual(BODY.left + BODY.width + EPS);
      previousBottom = rect.y + rect.h;
    }
  }
}

/** 描けた図の PNG（中身は割り付けに関係しないため空） */
const image = (width: number, height: number): DocImage => ({
  data: new Uint8Array(),
  mimeType: 'image/png',
  width,
  height,
  alt: '図',
});

/** 図の Mermaid のソース */
const MERMAID = 'graph TD; A-->B';

/**
 * 1 つの Mermaid の図だけが描けた図の表。
 *
 * @param img - 図の PNG
 * @returns 描けた図
 */
const diagramsWith = (img: DocImage): DiagramImages =>
  new Map([[diagramKey('mermaid', MERMAID), img]]);

describe('layoutPptx', () => {
  describe('正常系', () => {
    it('区切り線で分け、1 枚目の見出しと段落は表紙、ほかは先頭の見出しをタイトルにする', () => {
      const deck = layout(
        '# 旅のしおり\n\n3 日間の計画\n\n---\n\n## 1 日目\n\n- 京都\n\n---\n\n## 2 日目\n\n奈良へ'
      );
      expect(deck.slides.map((s) => s.kind)).toEqual([
        'cover',
        'content',
        'content',
      ]);
      const [cover] = deck.slides;
      expect(cover).toMatchObject({ kind: 'cover', title: '旅のしおり' });
      if (cover.kind === 'cover') {
        expect(cover.subtitle.map(paragraphText)).toEqual(['3 日間の計画']);
        expect(cover.subtitle[0].muted).toBe(true);
      }
      expect(content(deck.slides[1]).title).toBe('1 日目');
      expect(content(deck.slides[2]).title).toBe('2 日目');
      expect(content(deck.slides[2]).shapes.flatMap(texts)).toEqual(['奈良へ']);
    });

    it('区切り線が無ければ # と ## の前で分け、### はスライドの中の太字の段落にする', () => {
      const deck = layout(
        '# 題\n\n概要\n\n## A\n\n### a1\n\n本文\n\n## B\n\nx'
      );
      expect(deck.slides.map((s) => s.kind)).toEqual([
        'cover',
        'content',
        'content',
      ]);
      const a = content(deck.slides[1]);
      expect(a.title).toBe('A');
      const [sub, body] = a.shapes;
      expect(texts(sub)).toEqual(['a1']);
      expect(sub.type === 'text' && sub.paragraphs[0].bold).toBe(true);
      expect(texts(body)).toEqual(['本文']);
    });

    it('先頭が見出しでないスライドはタイトルなしで、本文を上から置く', () => {
      const deck = layout('はじめに\n\n---\n\n## A\n\nx');
      const first = content(deck.slides[0]);
      expect(first.title).toBeNull();
      expect(first.shapes[0].rect.y).toBeCloseTo(BODY.topWithoutTitle);
      expect(content(deck.slides[1]).shapes[0].rect.y).toBeCloseTo(
        BODY.topWithTitle
      );
    });

    it('図形を上から重ならずに積み、本文の枠に収める', () => {
      const deck = layout(
        '## 一覧\n\n段落\n\n- a\n- b\n\n| 列 | 値 |\n|---|---|\n| x | 1 |\n\n```ts\nconst a = 1;\n```\n\n> 引用\n\n注意'
      );
      expect(deck.slides).toHaveLength(1);
      expect(content(deck.slides[0]).shapes.map((s) => s.type)).toEqual([
        'text',
        'text',
        'table',
        'code',
        'quote',
        'text',
      ]);
      expectInsideBody(deck);
    });

    it('リストは項目ごとの段落で、入れ子は字下げ、番号付きは同じ連番（最初の番号をそろえる）、タスクはチェックの記号にする', () => {
      const deck = layout(
        '## L\n\n- 親\n  - 子\n\n1. 一\n2. 二\n\n- [x] 済み\n- [ ] まだ'
      );
      const [bullets, numbers, tasks] = content(deck.slides[0]).shapes;
      if (bullets.type !== 'text') throw new Error('expected text');
      expect(bullets.paragraphs.map((p) => p.bullet)).toEqual([
        { type: 'bullet', level: 0 },
        { type: 'bullet', level: 1 },
      ]);
      if (numbers.type !== 'text') throw new Error('expected text');
      expect(numbers.paragraphs.map((p) => p.bullet)).toEqual([
        { type: 'number', startAt: 1, level: 0 },
        { type: 'number', startAt: 1, level: 0 },
      ]);
      if (tasks.type !== 'text') throw new Error('expected text');
      expect(tasks.paragraphs.map((p) => p.bullet)).toEqual([
        { type: 'bullet', char: '☑', level: 0 },
        { type: 'bullet', char: '☐', level: 0 },
      ]);
    });

    it('リストの項目の中の段落・コードは改行でつないで 1 つの段落にする', () => {
      const deck = layout('## L\n\n- 説明\n\n  続き\n\n  ```\n  npm i\n  ```');
      const [list] = content(deck.slides[0]).shapes;
      expect(texts(list)).toEqual(['説明\n続き\nnpm i']);
    });

    it('長いリストは項目の単位で続きのスライドへ送り、タイトルに（続き）を付け、番号を続きから数える', () => {
      const items = Array.from(
        { length: 30 },
        (_, i) => `${i + 1}. 項目 ${i + 1}`
      );
      const deck = layout(`## 手順\n\n${items.join('\n')}`);
      expect(deck.slides.length).toBeGreaterThan(1);
      expect(deck.slides.map((s) => content(s).title)).toEqual([
        '手順',
        ...deck.slides.slice(1).map(() => '手順（続き）'),
      ]);
      const paragraphs = deck.slides.flatMap((s) =>
        content(s).shapes.flatMap((shape) =>
          shape.type === 'text' ? shape.paragraphs : []
        )
      );
      expect(paragraphs.map(paragraphText)).toEqual(
        items.map((_, i) => `項目 ${i + 1}`)
      );
      // スライドごとの連番の最初の番号は、そのスライドの最初の項目の番号（PowerPoint が何番目かを足す）
      const starts = deck.slides.map((slide) => {
        const shape = content(slide).shapes[0];
        return shape.type === 'text' ? shape.paragraphs : [];
      });
      let offset = 0;
      for (const slideParagraphs of starts) {
        for (const p of slideParagraphs) {
          expect(p.bullet).toEqual({
            type: 'number',
            startAt: offset + 1,
            level: 0,
          });
        }
        offset += slideParagraphs.length;
      }
      expectInsideBody(deck);
    });

    it('長い表は行の単位で分け、続きのスライドでも見出しの行を繰り返す', () => {
      const rows = Array.from({ length: 40 }, (_, i) => `| ${i} | 値 ${i} |`);
      const deck = layout(
        `## 表\n\n| 番号 | 値 |\n|---|---|\n${rows.join('\n')}`
      );
      expect(deck.slides.length).toBeGreaterThan(1);
      const tables = deck.slides.flatMap((s) =>
        content(s).shapes.filter((shape) => shape.type === 'table')
      );
      for (const table of tables) {
        if (table.type !== 'table') continue;
        expect(
          table.header.map((cell) => paragraphText({ runs: cell, fontSize: 0 }))
        ).toEqual(['番号', '値']);
      }
      const numbers = tables.flatMap((table) =>
        table.type === 'table'
          ? table.rows.map((row) =>
              paragraphText({ runs: row[0], fontSize: 0 })
            )
          : []
      );
      expect(numbers).toEqual(rows.map((_, i) => String(i)));
      expectInsideBody(deck);
    });

    it('長いコードは行の単位で分け、行を欠けさせない', () => {
      const lines = Array.from({ length: 60 }, (_, i) => `line ${i}`);
      const deck = layout(`## コード\n\n\`\`\`\n${lines.join('\n')}\n\`\`\``);
      expect(deck.slides.length).toBeGreaterThan(1);
      const code = deck.slides.flatMap((s) =>
        content(s).shapes.flatMap((shape) =>
          shape.type === 'code' ? shape.text.split('\n') : []
        )
      );
      expect(code).toEqual(lines);
      expectInsideBody(deck);
    });

    it('描けた図は画像にし、本文の幅に収めて縦横比を保ち、中央に置く', () => {
      const deck = layout(`## 図\n\n\`\`\`mermaid\n${MERMAID}\n\`\`\``, {
        diagrams: diagramsWith(image(3000, 600)),
      });
      const [shape] = content(deck.slides[0]).shapes;
      expect(shape.type).toBe('image');
      expect(shape.rect.w).toBeCloseTo(BODY.width);
      expect(shape.rect.w / shape.rect.h).toBeCloseTo(3000 / 600);
      expect(shape.rect.x).toBeCloseTo(BODY.left);
      expectInsideBody(deck);
    });

    it('小さい図は元の大きさのまま中央に置く', () => {
      const deck = layout(`## 図\n\n\`\`\`mermaid\n${MERMAID}\n\`\`\``, {
        diagrams: diagramsWith(image(192, 96)),
      });
      const [shape] = content(deck.slides[0]).shapes;
      expect(shape.rect.w).toBeCloseTo(2);
      expect(shape.rect.h).toBeCloseTo(1);
      expect(shape.rect.x + shape.rect.w / 2).toBeCloseTo(
        BODY.left + BODY.width / 2
      );
    });

    it('中断した応答は、最後のスライドに注記を置く', () => {
      const deck = layout('## A\n\n- x\n\n## B\n\ny', {
        interrupted: true,
      });
      const last = content(deck.slides[deck.slides.length - 1]);
      expect(last.shapes.flatMap(texts)).toEqual([
        'y',
        '（生成を中断した応答）',
      ]);
      expect(content(deck.slides[0]).shapes.flatMap(texts)).toEqual(['x']);
    });

    it('文書のブロックの種類（区切り線・見出し・段落・そのほか）を返す', () => {
      expect(kindOfDocBlock({ type: 'rule' })).toEqual({ type: 'rule' });
      expect(kindOfDocBlock({ type: 'heading', depth: 3, runs: [] })).toEqual({
        type: 'heading',
        depth: 3,
      });
      expect(kindOfDocBlock({ type: 'paragraph', runs: [] })).toEqual({
        type: 'paragraph',
      });
      expect(
        kindOfDocBlock({ type: 'code', language: null, text: '' })
      ).toEqual({ type: 'other' });
    });
  });

  describe('準正常系', () => {
    it('本文が空なら、会話のタイトルの表紙を 1 枚にする', () => {
      expect(layout('').slides).toEqual([
        { kind: 'cover', title: '旅行の計画', subtitle: [] },
      ]);
    });

    it('本文が空で中断した応答は、表紙に注記を置く', () => {
      const [cover] = layout('', { interrupted: true }).slides;
      expect(
        cover.kind === 'cover' && cover.subtitle.map(paragraphText)
      ).toEqual(['（生成を中断した応答）']);
    });

    it('先頭の front matter を取り除き、コメントだけの生の HTML は出さない（ほかの生の HTML は文字）', () => {
      const deck = layout(
        '---\nmarp: true\n---\n\n<!-- _class: lead -->\n\n## A\n\n<b>太字</b>\n\nx <!-- メモ --> y'
      );
      expect(deck.slides).toHaveLength(1);
      const slide = content(deck.slides[0]);
      expect(slide.title).toBe('A');
      expect(slide.shapes.flatMap(texts)).toEqual(['<b>太字</b>', 'x  y']);
    });

    it('分けられない長い段落は 1 枚に 1 つだけ置き、枠の高さに切り詰めてはみ出しの印を付ける', () => {
      const long = 'あ'.repeat(3000);
      const deck = layout(`## 長文\n\n短い前置き\n\n${long}`);
      expect(deck.slides).toHaveLength(2);
      const [shape] = content(deck.slides[1]).shapes;
      expect(content(deck.slides[1]).title).toBe('長文（続き）');
      expect(shape).toMatchObject({ type: 'text', overflow: true });
      expect(shape.rect.y + shape.rect.h).toBeCloseTo(BODY.bottom);
      expectInsideBody(deck);
    });

    it('前のブロックの後に入らない図は、次のスライドへ送る', () => {
      const lines = Array.from({ length: 14 }, (_, i) => `- ${i}`).join('\n');
      const deck = layout(
        `## 図\n\n${lines}\n\n\`\`\`mermaid\n${MERMAID}\n\`\`\``,
        { diagrams: diagramsWith(image(800, 800)) }
      );
      expect(deck.slides).toHaveLength(2);
      expect(content(deck.slides[1]).shapes.map((s) => s.type)).toEqual([
        'image',
      ]);
      expectInsideBody(deck);
    });

    it('会話のタイトルが空なら、書き出しの既定のタイトルにする', () => {
      expect(layout('', { title: '   ' }).title).not.toBe('');
    });
  });

  describe('異常系', () => {
    it('危ない URL のリンクは付けず、文字だけにする', () => {
      const deck = layout(
        '## A\n\n[押す](javascript:alert(1)) と [安全](https://example.com)'
      );
      const [shape] = content(deck.slides[0]).shapes;
      if (shape.type !== 'text') throw new Error('expected text');
      const links = shape.paragraphs[0].runs.flatMap((run) =>
        run.type === 'text' && run.link ? [run.link] : []
      );
      expect(links).toEqual(['https://example.com']);
      expect(paragraphText(shape.paragraphs[0])).toBe('押す と 安全');
    });

    it('描けなかった図はソースのコードにする', () => {
      const [shape] = content(
        layout(`## 図\n\n\`\`\`mermaid\n${MERMAID}\n\`\`\``).slides[0]
      ).shapes;
      expect(shape).toMatchObject({ type: 'code', text: MERMAID });
    });

    it('1 枚より高い図は、本文の枠の高さに縮める', () => {
      const deck = layout(`## 図\n\n\`\`\`mermaid\n${MERMAID}\n\`\`\``, {
        diagrams: diagramsWith(image(400, 4000)),
      });
      const [shape] = content(deck.slides[0]).shapes;
      expect(shape.rect.h).toBeCloseTo(BODY.bottom - BODY.topWithTitle);
      expect(shape.rect.w / shape.rect.h).toBeCloseTo(400 / 4000);
    });
  });
});
