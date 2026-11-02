import {
  PPTX_CELL_INSET,
  PPTX_LINE_SPACING,
  PPTX_QUOTE_BAR,
  PPTX_SIDE_MARGIN,
  PPTX_SLIDE_SIZE,
} from '@/constants/chat/pptx';
import type {
  DiagramImages,
  DocBlock,
  DocImage,
  DocListItem,
  InlineRun,
} from '@/lib/chat/document-model';
import { markdownToBlocks } from '@/lib/chat/document-model';
import { normalizeTitle } from '@/lib/chat/export';
import type { SlidesInput } from '@/lib/chat/report-slides';
import type { SlideBlockKind } from '@/lib/chat/slides';
import { splitSlides, stripFrontMatter } from '@/lib/chat/slides';

/**
 * 応答の PPTX（#36。`docs/27-pptx-export.md`「スライドの割り付け」）の割り付けを決める純関数群。
 *
 * 本文を文書の中間の形（DOCX と共通）にし、HTML スライドと同じ `splitSlides` で分け、スライドごとに図形の位置と大きさ
 * （インチ）を決める。PPTX のスライドは伸ばせないため、文字数から高さを見積もり、本文の枠に収まらない分は
 * 続きのスライドへ送る（リストは項目、表は行、コードは行の単位）。pptxgenjs には依存しない。
 */

/** 図形の位置と大きさ（インチ）。 */
export type PptxRect = {
  /** 左端 */
  x: number;
  /** 上端 */
  y: number;
  /** 幅 */
  w: number;
  /** 高さ */
  h: number;
};

/** テキストボックスの 1 段落。 */
export type PptxParagraph = {
  /** 文字の並び（改行は段落の中の改行） */
  runs: InlineRun[];
  /** 文字の大きさ（pt） */
  fontSize: number;
  /** 段落全体を太字にする（スライドの中の見出し） */
  bold?: boolean;
  /** 灰色の文字（注記・引用・表紙のサブタイトル） */
  muted?: boolean;
  /** 斜体（引用） */
  italic?: boolean;
  /** 箇条書きの記号。無ければふつうの段落 */
  bullet?:
    | {
        /** 記号の箇条書き */
        type: 'bullet';
        /** 記号の文字（タスクの `☐` / `☑`。無ければ既定の記号） */
        char?: string;
        /** 字下げの段階（0 始まり） */
        level: number;
      }
    | {
        /** 番号付き */
        type: 'number';
        /**
         * 連番の最初の番号（同じリストの段落はすべて同じ値。続きのスライドでは続きの番号）。
         * PowerPoint は連番の何番目かを数えて、この番号に足す
         */
        startAt: number;
        /** 字下げの段階（0 始まり） */
        level: number;
      };
};

/** スライドに置く図形。 */
export type PptxShape =
  | {
      /** テキストボックス（段落・見出し・リスト・注記） */
      type: 'text';
      /** 位置 */
      rect: PptxRect;
      /** 段落 */
      paragraphs: PptxParagraph[];
      /** 見積もりで枠を超えたもの（分けられない長い段落）。PowerPoint の「はみ出したら縮小」を付ける */
      overflow: boolean;
    }
  | {
      /** 引用（左の細い四角と、灰色の斜体のテキスト） */
      type: 'quote';
      /** 位置（左の四角を含む） */
      rect: PptxRect;
      /** 段落 */
      paragraphs: PptxParagraph[];
      /** 見積もりで枠を超えたもの */
      overflow: boolean;
    }
  | {
      /** コード（等幅・薄い灰色の塗り） */
      type: 'code';
      /** 位置 */
      rect: PptxRect;
      /** 本文（行の単位で分けたあとの一部） */
      text: string;
      /** 文字の大きさ（pt） */
      fontSize: number;
    }
  | {
      /** 表 */
      type: 'table';
      /** 位置 */
      rect: PptxRect;
      /** 列ごとの揃え */
      align: ('left' | 'center' | 'right' | null)[];
      /** 見出しの行（続きのスライドでも繰り返す） */
      header: InlineRun[][];
      /** 本文の行（行の単位で分けたあとの一部） */
      rows: InlineRun[][][];
      /** 行の高さ（インチ。見出しの行・本文の行の順。見積もった高さを PowerPoint の行の高さにする） */
      rowHeights: number[];
      /** 文字の大きさ（pt） */
      fontSize: number;
    }
  | {
      /** 画像（描けた図） */
      type: 'image';
      /** 位置（縦横比を保って縮めたもの） */
      rect: PptxRect;
      /** 画像 */
      image: DocImage;
    }
  | {
      /** 細い線（リスト・引用の外に残った区切り線） */
      type: 'line';
      /** 位置（高さは 0） */
      rect: PptxRect;
    };

/** 1 枚のスライド。 */
export type PptxSlide =
  | {
      /** 表紙（タイトルを中央に大きく、段落をサブタイトルに） */
      kind: 'cover';
      /** タイトル */
      title: string;
      /** サブタイトル（無ければ空） */
      subtitle: PptxParagraph[];
    }
  | {
      /** 本文のスライド */
      kind: 'content';
      /** スライドのタイトル（先頭が見出しでなければ `null`） */
      title: string | null;
      /** 本文の図形（上から順） */
      shapes: PptxShape[];
    };

/** PPTX の全体。 */
export type PptxDeck = {
  /** 会話のタイトル（ファイルの情報・フッター） */
  title: string;
  /** スライド */
  slides: PptxSlide[];
};

/** 本文の枠の上端（タイトルあり / なし）と下端（インチ） */
const BODY_TOP_WITH_TITLE = 1.6;
const BODY_TOP_WITHOUT_TITLE = 0.5;
const BODY_BOTTOM = 6.7;

/** 本文の枠の幅（インチ） */
const BODY_WIDTH = PPTX_SLIDE_SIZE.width - PPTX_SIDE_MARGIN * 2;

/** ブロックの間の空き（インチ） */
const BLOCK_GAP = 0.15;

/** 文字の大きさ（pt） */
const FONT = {
  body: 18,
  heading: 22,
  subheading: 20,
  table: 14,
  code: 13,
  note: 14,
  subtitle: 20,
} as const;

/** 1pt のインチ */
const PT = 1 / 72;

/** 行の高さ（文字の大きさに対する倍率。PowerPoint へは同じ倍率の固定の間隔で渡す） */
const LINE_HEIGHT = PPTX_LINE_SPACING;

/**
 * 表のセルの行の高さ（文字の大きさに対する倍率）。セルには固定の行の間隔を渡せず、フォントの既定の行の高さになるため、
 * 大きめに見積もる（見積もった高さを PowerPoint の行の高さに指定するので、文字が収まれば行はこの高さになる）
 */
const TABLE_LINE_HEIGHT = 1.5;

/** テキストボックスの内側の余白（インチ。PowerPoint の既定の左右 0.1・上下 0.05） */
const TEXT_INSET = { x: 0.1, y: 0.05 } as const;

/** コードの枠の内側の余白（インチ） */
const CODE_INSET = 0.15;

/** 箇条書きの字下げ（インチ。pptxgenjs の既定の 27pt） */
const BULLET_INDENT = 27 * PT;

/** 半角の文字の幅（全角を 1 とした比。プロポーショナルの見積もり） */
const NARROW_WIDTH = 0.55;

/** 等幅のフォントの半角の文字の幅（全角を 1 とした比） */
const MONO_WIDTH = 0.6;

/** 全角として数える文字（CJK・かな・全角の記号・ハングル）の最初のコードポイント */
const WIDE_FROM = 0x2e80;

/** 図をこれより小さくしか置けないとき、次のスライドへ送る（インチ） */
const MIN_IMAGE_HEIGHT = 1.5;

/** 画像の px のインチ（96dpi） */
const PX = 1 / 96;

/** 続きのスライドのタイトルに付ける印 */
const CONTINUED = '（続き）';

/** 中断した応答の注記 */
const INTERRUPTED_NOTE = '（生成を中断した応答）';

/**
 * 文字列の幅を、全角の文字を 1 として数える。
 *
 * @param text - 文字列
 * @param narrow - 半角の文字の幅
 * @returns 幅（全角の文字の数で）
 */
function textWidth(text: string, narrow: number): number {
  let width = 0;
  for (const char of text) {
    width += (char.codePointAt(0) ?? 0) >= WIDE_FROM ? 1 : narrow;
  }
  return width;
}

/**
 * 文字列を指定の幅に折り返したときの行数を見積もる。
 *
 * @param text - 文字列（改行を含めない）
 * @param fontSize - 文字の大きさ（pt）
 * @param width - 文字を置ける幅（インチ）
 * @param narrow - 半角の文字の幅
 * @returns 行数（空でも 1）
 */
function wrappedLines(
  text: string,
  fontSize: number,
  width: number,
  narrow: number
): number {
  const perLine = Math.max(1, width / (fontSize * PT));
  return Math.max(1, Math.ceil(textWidth(text, narrow) / perLine));
}

/**
 * 文字の並びを、段落の中の改行で行に分けた文字列にする。
 *
 * @param runs - 文字の並び
 * @returns 行ごとの文字列
 */
function runLines(runs: InlineRun[]): string[] {
  const lines = [''];
  for (const run of runs) {
    if (run.type === 'break') lines.push('');
    else lines[lines.length - 1] += run.text;
  }
  return lines;
}

/**
 * 文字の並びを 1 行の文字列にする（スライドのタイトル）。
 *
 * @param runs - 文字の並び
 * @returns 文字列（改行は空白）
 */
function plainText(runs: InlineRun[]): string {
  return runLines(runs).join(' ').trim();
}

/**
 * 段落の高さを見積もる。
 *
 * @param paragraph - 段落
 * @param width - テキストボックスの幅（インチ）
 * @returns 高さ（インチ。内側の余白を含めない）
 */
function paragraphHeight(paragraph: PptxParagraph, width: number): number {
  const indent = paragraph.bullet
    ? BULLET_INDENT * (paragraph.bullet.level + 1)
    : 0;
  const textArea = width - TEXT_INSET.x * 2 - indent;
  const lines = runLines(paragraph.runs).reduce(
    (sum, line) =>
      sum + wrappedLines(line, paragraph.fontSize, textArea, NARROW_WIDTH),
    0
  );
  return lines * paragraph.fontSize * PT * LINE_HEIGHT;
}

/**
 * テキストボックスの高さを見積もる。
 *
 * @param paragraphs - 段落
 * @param width - テキストボックスの幅（インチ）
 * @returns 高さ（インチ。内側の余白を含む）
 */
function textBoxHeight(paragraphs: PptxParagraph[], width: number): number {
  return (
    paragraphs.reduce((sum, p) => sum + paragraphHeight(p, width), 0) +
    TEXT_INSET.y * 2
  );
}

/**
 * ブロックを、リストの項目・引用の中に入れる文字の並びにする（1 つのテキストボックスに入れるため、文字だけにする）。
 *
 * @param block - ブロック
 * @returns 文字の並び（文字にできないものは空）
 */
function inlineOf(block: DocBlock): InlineRun[] {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      return block.runs;
    case 'code':
      return block.text
        .split('\n')
        .flatMap((line, index): InlineRun[] => [
          ...(index > 0 ? [{ type: 'break' } as const] : []),
          { type: 'text', text: line, code: true },
        ]);
    case 'table':
      return block.rows.flatMap((row, index): InlineRun[] => [
        ...(index > 0 ? [{ type: 'break' } as const] : []),
        ...row.flatMap((cell, cellIndex): InlineRun[] => [
          ...(cellIndex > 0 ? [{ type: 'text', text: ' | ' } as const] : []),
          ...cell,
        ]),
      ]);
    case 'quote':
      return joinRuns(block.blocks.map(inlineOf));
    case 'list':
      return joinRuns(
        block.items.map((item) => joinRuns(item.blocks.map(inlineOf)))
      );
    case 'image':
      return [{ type: 'text', text: `［${block.image.alt}］` }];
    case 'note':
      return [{ type: 'text', text: block.text }];
    case 'rule':
      return [];
  }
}

/**
 * 文字の並びを、段落の中の改行でつなぐ（空の並びは飛ばす）。
 *
 * @param parts - 文字の並びの並び
 * @returns つないだ文字の並び
 */
function joinRuns(parts: InlineRun[][]): InlineRun[] {
  return parts
    .filter((runs) => runs.length > 0)
    .flatMap((runs, index): InlineRun[] =>
      index > 0 ? [{ type: 'break' }, ...runs] : runs
    );
}

/**
 * リストの項目を段落にする。項目の中の段落・コードなどは改行でつないで 1 つの段落にし、入れ子のリストは字下げした段落にする。
 *
 * @param item - 項目
 * @param ordered - 番号付きのリストか
 * @param level - 字下げの段階
 * @returns 段落（先頭がこの項目、続けて入れ子の項目）。番号付きの連番は 1 から（続きのスライドでは呼び出し側が直す）
 */
function itemParagraphs(
  item: DocListItem,
  ordered: boolean,
  level: number
): PptxParagraph[] {
  const nested = item.blocks.filter(
    (block): block is Extract<DocBlock, { type: 'list' }> =>
      block.type === 'list'
  );
  const own = joinRuns(
    item.blocks.filter((block) => block.type !== 'list').map(inlineOf)
  );
  const bullet: PptxParagraph['bullet'] =
    item.checked !== null
      ? { type: 'bullet', char: item.checked ? '☑' : '☐', level }
      : ordered
        ? { type: 'number', startAt: 1, level }
        : { type: 'bullet', level };
  return [
    { runs: own, fontSize: FONT.body, bullet },
    ...nested.flatMap((list) =>
      list.items.flatMap((child) =>
        itemParagraphs(child, list.ordered, level + 1)
      )
    ),
  ];
}

/** 割り付けの途中のスライド。 */
type Page = {
  /** スライドのタイトル */
  title: string | null;
  /** 置いた図形 */
  shapes: PptxShape[];
  /** 次の図形を置く上端（インチ） */
  cursor: number;
};

/**
 * 1 枚分（`splitSlides` の 1 枚）のブロックを、本文のスライドに割り付ける。収まらない分は続きのスライドにする。
 *
 * @param title - スライドのタイトル（無ければ `null`）
 * @param blocks - タイトルを除いたブロック
 * @returns 本文のスライド（1 枚以上）
 */
function layoutContent(title: string | null, blocks: DocBlock[]): PptxSlide[] {
  const top = title ? BODY_TOP_WITH_TITLE : BODY_TOP_WITHOUT_TITLE;
  const pages: Page[] = [{ title, shapes: [], cursor: top }];
  const current = () => pages[pages.length - 1];
  const remaining = () => BODY_BOTTOM - current().cursor;
  const newPage = () => {
    pages.push({
      title: title ? `${title}${CONTINUED}` : null,
      shapes: [],
      cursor: top,
    });
  };
  const place = (shape: PptxShape) => {
    current().shapes.push(shape);
    current().cursor += shape.rect.h + BLOCK_GAP;
  };
  const rectOf = (
    h: number,
    x = PPTX_SIDE_MARGIN,
    w = BODY_WIDTH
  ): PptxRect => ({
    x,
    y: current().cursor,
    w,
    h,
  });

  /**
   * 分けられないテキストを置く。今のスライドに入らなければ次のスライドへ送り、1 枚にも入らなければ枠の高さで置く。
   *
   * @param make - 位置と、はみ出しの有無から図形を作る関数
   * @param height - 見積もった高さ
   */
  const placeWhole = (
    make: (rect: PptxRect, overflow: boolean) => PptxShape,
    height: number
  ) => {
    if (height > remaining() && current().shapes.length > 0) newPage();
    const overflow = height > remaining();
    place(make(rectOf(overflow ? remaining() : height), overflow));
  };

  /**
   * 単位（リストの項目・表の行・コードの行）に分けられるブロックを置く。今のスライドに入るだけ置き、残りは次のスライドへ。
   *
   * @param units - 単位ごとの高さ
   * @param overhead - 単位のほかに要る高さ（内側の余白・表の見出しの行）
   * @param make - 置く単位の範囲と高さから図形を作る関数
   */
  const placeUnits = (
    units: number[],
    overhead: number,
    make: (from: number, to: number, height: number) => PptxShape
  ) => {
    let from = 0;
    while (from < units.length) {
      let to = from;
      let height = overhead;
      while (to < units.length && height + units[to] <= remaining()) {
        height += units[to];
        to++;
      }
      if (to === from) {
        if (current().shapes.length > 0) {
          newPage();
          continue;
        }
        // 1 つの単位だけで 1 枚に入らない（とても長い項目・行）。その単位だけを枠の高さで置く
        height = Math.min(overhead + units[from], remaining());
        to = from + 1;
      }
      place(make(from, to, height));
      from = to;
      if (from < units.length) newPage();
    }
  };

  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
      case 'paragraph':
      case 'note': {
        const paragraph: PptxParagraph =
          block.type === 'note'
            ? {
                runs: [{ type: 'text', text: block.text }],
                fontSize: FONT.note,
                muted: true,
              }
            : block.type === 'heading'
              ? {
                  runs: block.runs,
                  fontSize: block.depth <= 2 ? FONT.heading : FONT.subheading,
                  bold: true,
                }
              : { runs: block.runs, fontSize: FONT.body };
        placeWhole(
          (rect, overflow) => ({
            type: 'text',
            rect,
            paragraphs: [paragraph],
            overflow,
          }),
          textBoxHeight([paragraph], BODY_WIDTH)
        );
        break;
      }
      case 'quote': {
        const paragraphs = block.blocks
          .map(inlineOf)
          .filter((runs) => runs.length > 0)
          .map((runs): PptxParagraph => ({
            runs,
            fontSize: FONT.body,
            muted: true,
            italic: true,
          }));
        const textWidthIn =
          BODY_WIDTH - PPTX_QUOTE_BAR.width - PPTX_QUOTE_BAR.gap;
        placeWhole(
          (rect, overflow) => ({ type: 'quote', rect, paragraphs, overflow }),
          textBoxHeight(paragraphs, textWidthIn)
        );
        break;
      }
      case 'list': {
        const items = block.items.map((item) =>
          itemParagraphs(item, block.ordered, 0)
        );
        placeUnits(
          items.map((paragraphs) =>
            paragraphs.reduce(
              (sum, p) => sum + paragraphHeight(p, BODY_WIDTH),
              0
            )
          ),
          TEXT_INSET.y * 2,
          (from, to, height) => ({
            type: 'text',
            rect: rectOf(height),
            // 続きのスライドでは、最上位の連番を続きの番号から始める（入れ子の連番は親の項目ごとに 1 から）
            paragraphs: items
              .slice(from, to)
              .flat()
              .map((p) =>
                p.bullet?.type === 'number' && p.bullet.level === 0
                  ? { ...p, bullet: { ...p.bullet, startAt: from + 1 } }
                  : p
              ),
            overflow: false,
          })
        );
        break;
      }
      case 'code': {
        const lines = block.text.split('\n');
        const area = BODY_WIDTH - CODE_INSET * 2;
        placeUnits(
          lines.map(
            (line) =>
              wrappedLines(line, FONT.code, area, MONO_WIDTH) *
              FONT.code *
              PT *
              LINE_HEIGHT
          ),
          CODE_INSET * 2,
          (from, to, height) => ({
            type: 'code',
            rect: rectOf(height),
            text: lines.slice(from, to).join('\n'),
            fontSize: FONT.code,
          })
        );
        break;
      }
      case 'table': {
        const [header = [], ...rows] = block.rows;
        const columns = Math.max(1, ...block.rows.map((row) => row.length));
        const cellArea = BODY_WIDTH / columns - PPTX_CELL_INSET.x * 2;
        const rowHeight = (row: InlineRun[][]) =>
          Math.max(
            1,
            ...row.map((cell) =>
              runLines(cell).reduce(
                (sum, line) =>
                  sum + wrappedLines(line, FONT.table, cellArea, NARROW_WIDTH),
                0
              )
            )
          ) *
            FONT.table *
            PT *
            TABLE_LINE_HEIGHT +
          PPTX_CELL_INSET.y * 2;
        const headerHeight = rowHeight(header);
        const make = (from: number, to: number, height: number): PptxShape => ({
          type: 'table',
          rect: rectOf(height),
          align: block.align,
          header,
          rows: rows.slice(from, to),
          rowHeights: [headerHeight, ...rows.slice(from, to).map(rowHeight)],
          fontSize: FONT.table,
        });
        if (rows.length === 0) {
          placeWhole((rect) => ({ ...make(0, 0, 0), rect }), headerHeight);
        } else {
          placeUnits(rows.map(rowHeight), headerHeight, make);
        }
        break;
      }
      case 'image': {
        const natural = {
          w: block.image.width * PX,
          h: block.image.height * PX,
        };
        if (remaining() < MIN_IMAGE_HEIGHT && current().shapes.length > 0) {
          newPage();
        }
        const scale = Math.min(
          1,
          BODY_WIDTH / natural.w,
          remaining() / natural.h
        );
        const w = natural.w * scale;
        place({
          type: 'image',
          rect: rectOf(
            natural.h * scale,
            PPTX_SIDE_MARGIN + (BODY_WIDTH - w) / 2,
            w
          ),
          image: block.image,
        });
        break;
      }
      case 'rule':
        place({ type: 'line', rect: rectOf(0) });
        break;
    }
  }

  return pages.map((page) => ({
    kind: 'content',
    title: page.title,
    shapes: page.shapes,
  }));
}

/**
 * 文書のブロックを、スライドの分け方から見た種類にする（HTML スライドの `kindOfHast` と対）。
 *
 * @param block - 本文の最上位のブロック
 * @returns ブロックの種類
 */
export function kindOfDocBlock(block: DocBlock): SlideBlockKind {
  switch (block.type) {
    case 'rule':
      return { type: 'rule' };
    case 'heading':
      return { type: 'heading', depth: block.depth };
    case 'paragraph':
      return { type: 'paragraph' };
    default:
      return { type: 'other' };
  }
}

/**
 * 応答の PPTX の割り付けを決める。
 *
 * 本文の先頭の front matter と、コメントだけの生の HTML は出さない。HTML スライドと同じ規則でスライドに分け、
 * 表紙に向く 1 枚目は表紙に、ほかは先頭の見出しをタイトルにして本文を上から積む。本文が空なら会話のタイトルの表紙を 1 枚にする。
 * 中断した応答は、最後のスライドに注記を置く。
 *
 * @param input - スライドにする応答（HTML スライドと同じ）
 * @param diagrams - 描けた図の PNG（描けなかった図はソースのコード）
 * @returns PPTX の全体
 */
export function layoutPptx(
  input: SlidesInput,
  diagrams: DiagramImages
): PptxDeck {
  const title = normalizeTitle(input.title);
  const blocks = markdownToBlocks(stripFrontMatter(input.content), diagrams, {
    dropHtmlComments: true,
  });
  const split = splitSlides(blocks, kindOfDocBlock);

  const slides: PptxSlide[] = split.flatMap((slide, index): PptxSlide[] => {
    const own = [...slide.blocks];
    if (input.interrupted && index === split.length - 1) {
      own.push({ type: 'note', text: INTERRUPTED_NOTE });
    }
    if (slide.cover) {
      const headingIndex = own.findIndex((block) => block.type === 'heading');
      const heading = own[headingIndex];
      return [
        {
          kind: 'cover',
          title:
            heading && heading.type === 'heading'
              ? plainText(heading.runs)
              : title,
          subtitle: own
            .filter((_, i) => i !== headingIndex)
            .map((block): PptxParagraph => ({
              runs: inlineOf(block),
              fontSize: FONT.subtitle,
              muted: true,
            })),
        },
      ];
    }
    const [first, ...rest] = own;
    return first?.type === 'heading'
      ? layoutContent(plainText(first.runs) || null, rest)
      : layoutContent(null, own);
  });

  if (slides.length === 0) {
    slides.push({
      kind: 'cover',
      title,
      subtitle: input.interrupted
        ? [
            {
              runs: [{ type: 'text', text: INTERRUPTED_NOTE }],
              fontSize: FONT.note,
              muted: true,
            },
          ]
        : [],
    });
  }
  return { title, slides };
}
