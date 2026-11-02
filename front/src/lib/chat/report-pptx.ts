import type PptxGenJS from 'pptxgenjs';
import {
  PPTX_CELL_INSET,
  PPTX_LINE_SPACING,
  PPTX_QUOTE_BAR,
  PPTX_SIDE_MARGIN,
  PPTX_SLIDE_SIZE,
  PPTX_TITLE_RECT,
} from '@/constants/chat/pptx';
import type { DocImage, InlineRun } from '@/lib/chat/document-model';
import type {
  PptxDeck,
  PptxParagraph,
  PptxShape,
  PptxSlide,
} from '@/lib/chat/pptx-layout';

/**
 * 割り付け（`pptx-layout.ts`）を、pptxgenjs の図形にする（#36。`docs/27-pptx-export.md`「PowerPoint の部品への対応」）。
 *
 * pptxgenjs は大きいため、このファイルは型だけを import し、本体（`import('pptxgenjs')` の既定の export）は呼び出し側から
 * 受け取る（DOCX の `report-docx.ts` と同じ）。UT では node の pptxgenjs を渡して確かめる。
 */

/** pptxgenjs のクラス（`new` してプレゼンテーションを作る） */
export type PptxGenJSClass = new () => PptxGenJS;

/** スライドマスターの名前（本文 / 表紙） */
const CONTENT_MASTER = 'REPORT_CONTENT';
const COVER_MASTER = 'REPORT_COVER';

/** pptxgenjs の組み込みのレイアウト（13.333 × 7.5 インチ。`PPTX_SLIDE_SIZE` と同じ） */
const WIDE_LAYOUT = 'LAYOUT_WIDE';

/** 本文のフォント（英数字も游ゴシック。pptxgenjs は英数字・日本語の両方に同じフォントを当てる） */
const BODY_FONT = 'Yu Gothic';

/** コードのフォント */
const CODE_FONT = 'Consolas';

/** 文字の言語（校正・改行の規則を日本語にする） */
const LANG = 'ja-JP';

/** 色（Nord。HTML スライドと同じ） */
const COLOR = {
  text: '2E3440',
  muted: '4C566A',
  accent: '5E81AC',
  accentLight: '88C0D0',
  border: 'D8DEE9',
  headerFill: 'E5E9F0',
  codeFill: 'F3F4F6',
  background: 'FFFFFF',
} as const;

/** 文字の大きさ（pt） */
const FONT_SIZE = { title: 32, coverTitle: 40, footer: 10 } as const;

/** フッターの上端と高さ（インチ） */
const FOOTER = { y: 7.0, h: 0.35 } as const;

/** フッターの右端のスライド番号の幅（インチ） */
const SLIDE_NUMBER_WIDTH = 1.0;

/** 表紙のタイトルの枠（インチ。上下の中央より少し上） */
const COVER_TITLE_RECT = {
  x: PPTX_SIDE_MARGIN,
  y: 1.8,
  w: PPTX_SLIDE_SIZE.width - PPTX_SIDE_MARGIN * 2,
  h: 2.0,
} as const;

/** 表紙のサブタイトルの枠（インチ。タイトルの下） */
const COVER_SUBTITLE_RECT = {
  x: PPTX_SIDE_MARGIN,
  y: 4.0,
  w: PPTX_SLIDE_SIZE.width - PPTX_SIDE_MARGIN * 2,
  h: 2.5,
} as const;

/** タイトルの下の線の太さ（pt） */
const TITLE_RULE_WIDTH = 2;

/** コードの枠の内側の余白（pt。割り付けの 0.15 インチ） */
const CODE_MARGIN_PT = 10.8;

/**
 * 文字の中の改行（Markdown の段落の中のふつうの改行）。pptxgenjs は文字の中の改行で段落を分けるため、空白にする
 * （HTML の表示と同じく、ふつうの改行は空白として扱う。段落の中の改行（`break`）は `softBreakBefore` で別に表す）
 */
const SOFT_LINE_BREAK = /\r?\n/g;

/**
 * 文字の片の文字列を、pptxgenjs に渡す形にする（ふつうの改行を空白にする）。
 *
 * @param text - 文字列
 * @returns 改行を空白にした文字列
 */
function runText(text: string): string {
  return text.replace(SOFT_LINE_BREAK, ' ');
}

/** バイト列を Base64 にするときに一度に文字にする長さ（`String.fromCharCode` の引数の数の上限を避ける） */
const BASE64_CHUNK = 0x8000;

/**
 * バイト列を Base64 にする。
 *
 * @param bytes - バイト列
 * @returns Base64 の文字列
 */
function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

/**
 * 画像を pptxgenjs の `data` の形（`data:image/png;base64,…`）にする。
 *
 * @param image - 画像
 * @returns `data:` URI
 */
function imageData(image: DocImage): string {
  return `data:${image.mimeType};base64,${encodeBase64(image.data)}`;
}

/**
 * 文字の大きさから、段落の固定の行の間隔（pt）を決める（割り付けの高さの見積もりと同じ倍率）。
 *
 * @param fontSize - 文字の大きさ（pt）
 * @returns 行の間隔（pt）
 */
function lineSpacingOf(fontSize: number): number {
  return fontSize * PPTX_LINE_SPACING;
}

/** 文字の片の飾りから作る、pptxgenjs の文字の指定 */
type RunOptions = NonNullable<PptxGenJS.TextProps['options']>;

/**
 * 文字の片の飾りを、pptxgenjs の文字の指定にする。
 *
 * pptxgenjs は渡した指定のオブジェクトを書き換える（図形の指定を写す）ため、呼ぶたびに新しいオブジェクトを返す。
 *
 * @param run - 文字の片
 * @returns 文字の指定
 */
function runOptions(run: Extract<InlineRun, { type: 'text' }>): RunOptions {
  return {
    lang: LANG,
    ...(run.bold && { bold: true }),
    ...(run.italic && { italic: true }),
    ...(run.strike && { strike: 'sngStrike' as const }),
    ...(run.code && { fontFace: CODE_FONT }),
    ...(run.link && { hyperlink: { url: run.link } }),
  };
}

/**
 * 段落を、pptxgenjs の文字の片の並びにする。段落の中の改行は次の片の `softBreakBefore`、段落の終わりは最後の片の
 * `breakLine` にする（pptxgenjs は `breakLine` で段落を分け、段落の書式（箇条書き）は段落の先頭の片から取る）。
 *
 * @param paragraph - 段落
 * @param last - 図形の最後の段落か（最後は `breakLine` を付けない）
 * @returns 文字の片の並び
 */
function paragraphProps(
  paragraph: PptxParagraph,
  last: boolean
): PptxGenJS.TextProps[] {
  const props: PptxGenJS.TextProps[] = [];
  let softBreak = false;
  for (const run of paragraph.runs) {
    if (run.type === 'break') {
      if (softBreak)
        props.push({ text: '', options: { softBreakBefore: true } });
      softBreak = true;
      continue;
    }
    props.push({
      text: runText(run.text),
      options: {
        ...runOptions(run),
        ...(softBreak && { softBreakBefore: true }),
      },
    });
    softBreak = false;
  }
  if (softBreak || props.length === 0) {
    props.push({ text: '', options: { softBreakBefore: softBreak } });
  }

  const paragraphOptions: RunOptions = {
    fontSize: paragraph.fontSize,
    lineSpacing: lineSpacingOf(paragraph.fontSize),
    ...(paragraph.bold && { bold: true }),
    ...(paragraph.italic && { italic: true }),
    ...(paragraph.muted && { color: COLOR.muted }),
  };
  props.forEach((prop) => {
    prop.options = { ...paragraphOptions, ...prop.options };
  });

  const bullet = paragraph.bullet;
  if (bullet) {
    props[0].options = {
      ...props[0].options,
      bullet:
        bullet.type === 'number'
          ? { type: 'number', numberStartAt: bullet.startAt }
          : bullet.char
            ? { characterCode: bullet.char.codePointAt(0)?.toString(16) }
            : true,
      ...(bullet.level > 0 && { indentLevel: bullet.level }),
    };
  }
  if (!last) {
    const end = props[props.length - 1];
    end.options = { ...end.options, breakLine: true };
  }
  return props;
}

/**
 * 段落の並びを、1 つのテキストボックスの文字の片の並びにする。
 *
 * @param paragraphs - 段落
 * @returns 文字の片の並び
 */
function textProps(paragraphs: PptxParagraph[]): PptxGenJS.TextProps[] {
  return paragraphs.flatMap((paragraph, index) =>
    paragraphProps(paragraph, index === paragraphs.length - 1)
  );
}

/**
 * 表のセルの文字の並びを、pptxgenjs のセルの中身にする（セルの中の改行は `breakLine`）。
 *
 * セルには固定の行の間隔を渡せない（pptxgenjs のセルの指定に無い）ため、行の高さは割り付けの見積もり（`rowHeights`）で指定する。
 *
 * @param runs - 文字の並び
 * @returns セルの文字の片の並び
 */
function cellProps(runs: InlineRun[]): PptxGenJS.TableCell[] {
  const cells: PptxGenJS.TableCell[] = [];
  for (const run of runs) {
    if (run.type === 'break') {
      const prev = cells[cells.length - 1];
      if (prev) prev.options = { ...prev.options, breakLine: true };
      else cells.push({ text: '', options: { breakLine: true } });
      continue;
    }
    cells.push({ text: runText(run.text), options: runOptions(run) });
  }
  return cells.length > 0 ? cells : [{ text: '' }];
}

/**
 * 図形を 1 つスライドに置く。
 *
 * @param slide - スライド
 * @param shape - 図形
 */
function addShape(slide: PptxGenJS.Slide, shape: PptxShape): void {
  const { x, y, w, h } = shape.rect;
  switch (shape.type) {
    case 'text':
      slide.addText(textProps(shape.paragraphs), {
        x,
        y,
        w,
        h,
        valign: 'top',
        fontFace: BODY_FONT,
        color: COLOR.text,
        ...(shape.overflow && { fit: 'shrink' as const }),
      });
      return;
    case 'quote':
      slide.addShape('rect', {
        x,
        y,
        w: PPTX_QUOTE_BAR.width,
        h,
        fill: { color: COLOR.accentLight },
        line: { color: COLOR.accentLight, width: 0 },
      });
      slide.addText(textProps(shape.paragraphs), {
        x: x + PPTX_QUOTE_BAR.width + PPTX_QUOTE_BAR.gap,
        y,
        w: w - PPTX_QUOTE_BAR.width - PPTX_QUOTE_BAR.gap,
        h,
        valign: 'top',
        fontFace: BODY_FONT,
        color: COLOR.muted,
        ...(shape.overflow && { fit: 'shrink' as const }),
      });
      return;
    case 'code':
      slide.addText(shape.text, {
        x,
        y,
        w,
        h,
        valign: 'top',
        fontFace: CODE_FONT,
        fontSize: shape.fontSize,
        lineSpacing: lineSpacingOf(shape.fontSize),
        color: COLOR.text,
        fill: { color: COLOR.codeFill },
        margin: CODE_MARGIN_PT,
        lang: LANG,
      });
      return;
    case 'table': {
      const columns = Math.max(
        1,
        shape.header.length,
        ...shape.rows.map((row) => row.length)
      );
      const row = (cells: InlineRun[][], header: boolean) =>
        Array.from({ length: columns }, (_, index): PptxGenJS.TableCell => ({
          text: cellProps(cells[index] ?? []),
          options: {
            align: shape.align[index] ?? 'left',
            valign: 'middle',
            ...(header && { bold: true, fill: { color: COLOR.headerFill } }),
          },
        }));
      slide.addTable(
        [row(shape.header, true), ...shape.rows.map((r) => row(r, false))],
        {
          x,
          y,
          w,
          colW: Array.from({ length: columns }, () => w / columns),
          rowH: shape.rowHeights,
          // 上・右・下・左（1 未満の値はインチとして読まれる）。割り付けの見積もりと同じ余白にする
          margin: [
            PPTX_CELL_INSET.y,
            PPTX_CELL_INSET.x,
            PPTX_CELL_INSET.y,
            PPTX_CELL_INSET.x,
          ],
          fontFace: BODY_FONT,
          fontSize: shape.fontSize,
          color: COLOR.text,
          border: { type: 'solid', pt: 1, color: COLOR.border },
          autoPage: false,
        }
      );
      return;
    }
    case 'image':
      slide.addImage({
        data: imageData(shape.image),
        x,
        y,
        w,
        h,
        altText: shape.image.alt,
      });
      return;
    case 'line':
      slide.addShape('line', {
        x,
        y,
        w,
        h: 0,
        line: { color: COLOR.border, width: 1 },
      });
      return;
  }
}

/**
 * スライドマスター（本文 / 表紙）を定義する。どちらも白い背景・タイトルの位置・左下の会話のタイトル・右下のスライド番号を持つ。
 *
 * @param pres - プレゼンテーション
 * @param title - 会話のタイトル（フッター）
 */
function defineMasters(pres: PptxGenJS, title: string): void {
  const footer = {
    text: {
      text: title,
      options: {
        x: PPTX_SIDE_MARGIN,
        y: FOOTER.y,
        w: PPTX_SLIDE_SIZE.width - PPTX_SIDE_MARGIN * 2 - SLIDE_NUMBER_WIDTH,
        h: FOOTER.h,
        fontFace: BODY_FONT,
        fontSize: FONT_SIZE.footer,
        color: COLOR.muted,
        lang: LANG,
      },
    },
  };
  const slideNumber = {
    x: PPTX_SLIDE_SIZE.width - PPTX_SIDE_MARGIN - SLIDE_NUMBER_WIDTH,
    y: FOOTER.y,
    w: SLIDE_NUMBER_WIDTH,
    h: FOOTER.h,
    fontFace: BODY_FONT,
    fontSize: FONT_SIZE.footer,
    color: COLOR.muted,
    align: 'right' as const,
  };
  pres.defineSlideMaster({
    title: CONTENT_MASTER,
    background: { color: COLOR.background },
    objects: [
      {
        placeholder: {
          options: {
            name: 'title',
            type: 'title',
            ...PPTX_TITLE_RECT,
            fontFace: BODY_FONT,
            fontSize: FONT_SIZE.title,
            bold: true,
            color: COLOR.text,
            align: 'left',
            valign: 'bottom',
          },
          text: '',
        },
      },
      footer,
    ],
    slideNumber,
  });
  pres.defineSlideMaster({
    title: COVER_MASTER,
    background: { color: COLOR.background },
    objects: [
      {
        placeholder: {
          options: {
            name: 'title',
            type: 'title',
            ...COVER_TITLE_RECT,
            fontFace: BODY_FONT,
            fontSize: FONT_SIZE.coverTitle,
            bold: true,
            color: COLOR.text,
            align: 'center',
            valign: 'bottom',
          },
          text: '',
        },
      },
      footer,
    ],
    slideNumber,
  });
}

/**
 * 1 枚のスライドを作る。
 *
 * @param pres - プレゼンテーション
 * @param slide - 割り付けたスライド
 */
function addSlide(pres: PptxGenJS, slide: PptxSlide): void {
  if (slide.kind === 'cover') {
    const page = pres.addSlide({ masterName: COVER_MASTER });
    page.addText(slide.title, { placeholder: 'title', lang: LANG });
    if (slide.subtitle.length > 0) {
      page.addText(textProps(slide.subtitle), {
        ...COVER_SUBTITLE_RECT,
        align: 'center',
        valign: 'top',
        fontFace: BODY_FONT,
        color: COLOR.muted,
        fit: 'shrink',
      });
    }
    return;
  }

  const page = pres.addSlide({ masterName: CONTENT_MASTER });
  if (slide.title) {
    page.addText(slide.title, { placeholder: 'title', lang: LANG });
    page.addShape('line', {
      x: PPTX_TITLE_RECT.x,
      y: PPTX_TITLE_RECT.y + PPTX_TITLE_RECT.h,
      w: PPTX_TITLE_RECT.w,
      h: 0,
      line: { color: COLOR.accentLight, width: TITLE_RULE_WIDTH },
    });
  }
  slide.shapes.forEach((shape) => addShape(page, shape));
}

/**
 * 割り付けから PPTX のプレゼンテーションを作る（保存は呼び出し側が `write` で行う）。
 *
 * @param Pptx - pptxgenjs のクラス（`import('pptxgenjs')` の既定の export）
 * @param deck - 割り付け
 * @returns プレゼンテーション
 */
export function buildPptx(Pptx: PptxGenJSClass, deck: PptxDeck): PptxGenJS {
  const pres = new Pptx();
  pres.layout = WIDE_LAYOUT;
  pres.title = deck.title;
  pres.theme = { headFontFace: BODY_FONT, bodyFontFace: BODY_FONT };
  defineMasters(pres, deck.title);
  deck.slides.forEach((slide) => addSlide(pres, slide));
  return pres;
}
