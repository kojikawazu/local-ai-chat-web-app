import type * as Docx from 'docx';
import type {
  DocBlock,
  DocImage,
  InlineRun,
  ReportDocument,
} from '@/lib/chat/document-model';

/**
 * 書き出しの文書の中間の形を、Word の DOCX の部品にする（#36。`docs/25-docx-export.md`「Word の書式への対応」）。
 *
 * `docx` は大きいため、このファイルは型だけを import し、本体（`import('docx')` の結果）は呼び出し側から受け取る
 * （静的に import すると、画面の最初の読み込みに入る）。UT では node の `docx` を渡して確かめる。
 */

/** 本文の幅に収める画像の最大の幅（px。A4 の幅 210mm から左右の余白 20mm を除いた 170mm ≒ 640px より少し小さく） */
const MAX_IMAGE_WIDTH = 600;

/** A4 の大きさ（twip。1mm ≒ 56.7 twip） */
const A4 = { width: 11906, height: 16838 } as const;

/** 余白（twip。20mm） */
const MARGIN = 1134;

/** 本文のフォント（英数字は Calibri、日本語は游ゴシック） */
const BODY_FONT = { ascii: 'Calibri', hAnsi: 'Calibri', eastAsia: 'Yu Gothic' };

/** コードのフォント */
const CODE_FONT = 'Consolas';

/** コードの網掛けの色 */
const CODE_SHADE = 'F3F4F6';

/** 罫線・区切り線の色（Nord の淡い灰色） */
const BORDER_COLOR = 'D8DEE9';

/** 注記・情報の文字の色 */
const MUTED_COLOR = '4C566A';

/** 箇条書き・番号付きリストの numbering の参照名 */
const BULLET = 'report-bullet';
const ORDERED = 'report-ordered';

/** 段落にできる部品（段落・表） */
type BodyElement = Docx.Paragraph | Docx.Table;

/** 変換の途中で受け継ぐもの */
type Context = {
  /** docx の本体 */
  docx: typeof Docx;
  /** 番号付きリストを、リストごとに 1 から数え直すための番号 */
  nextListInstance: () => number;
};

/**
 * 本文の Markdown の見出しの段階を、Word の見出しにする（メッセージの見出しが見出し 1 のため、`#` を見出し 2 にする）。
 *
 * @param docx - docx の本体
 * @param depth - Markdown の段階（1〜6）
 * @returns Word の見出しのスタイル
 */
function headingLevel(
  docx: typeof Docx,
  depth: number
): (typeof Docx.HeadingLevel)[keyof typeof Docx.HeadingLevel] {
  if (depth <= 1) return docx.HeadingLevel.HEADING_2;
  if (depth === 2) return docx.HeadingLevel.HEADING_3;
  return docx.HeadingLevel.HEADING_4;
}

/**
 * 文字の片の並びを、docx の文字の部品にする（リンクはハイパーリンクにする）。
 *
 * @param docx - docx の本体
 * @param runs - 文字の片の並び
 * @returns 段落の子
 */
function toRuns(
  docx: typeof Docx,
  runs: InlineRun[]
): (Docx.TextRun | Docx.ExternalHyperlink)[] {
  return runs.map((run) => {
    if (run.type === 'break') return new docx.TextRun({ text: '', break: 1 });
    const textRun = new docx.TextRun({
      text: run.text,
      bold: run.bold,
      italics: run.italic,
      strike: run.strike,
      ...(run.code && {
        font: CODE_FONT,
        shading: {
          type: docx.ShadingType.CLEAR,
          fill: CODE_SHADE,
          color: 'auto',
        },
      }),
      ...(run.link && { style: 'Hyperlink' }),
    });
    return run.link
      ? new docx.ExternalHyperlink({ link: run.link, children: [textRun] })
      : textRun;
  });
}

/**
 * 画像を本文の幅に収める大きさにする（小さい画像は元の大きさ）。
 *
 * @param image - 画像
 * @returns 表示の幅と高さ（px）
 */
function fitImage(image: DocImage): { width: number; height: number } {
  const scale = Math.min(1, MAX_IMAGE_WIDTH / image.width);
  return {
    width: Math.max(1, Math.round(image.width * scale)),
    height: Math.max(1, Math.round(image.height * scale)),
  };
}

/**
 * 画像の段落（中央揃え）を作る。
 *
 * @param docx - docx の本体
 * @param image - 画像
 * @returns 段落
 */
function imageParagraph(docx: typeof Docx, image: DocImage): Docx.Paragraph {
  return new docx.Paragraph({
    alignment: docx.AlignmentType.CENTER,
    children: [
      new docx.ImageRun({
        type: image.mimeType === 'image/png' ? 'png' : 'jpg',
        data: image.data,
        transformation: fitImage(image),
        altText: { name: image.alt, description: image.alt, title: image.alt },
      }),
    ],
  });
}

/**
 * 注記の段落（灰色の斜体）を作る。
 *
 * @param docx - docx の本体
 * @param text - 文
 * @returns 段落
 */
function noteParagraph(docx: typeof Docx, text: string): Docx.Paragraph {
  return new docx.Paragraph({
    children: [new docx.TextRun({ text, italics: true, color: MUTED_COLOR })],
  });
}

/**
 * 表を作る（罫線付き・見出しの行は網掛けと太字・幅は本文いっぱい）。
 *
 * @param docx - docx の本体
 * @param block - 表のブロック
 * @returns 表
 */
function toTable(
  docx: typeof Docx,
  block: Extract<DocBlock, { type: 'table' }>
): Docx.Table {
  const alignment = (index: number) => {
    const align = block.align[index];
    if (align === 'center') return docx.AlignmentType.CENTER;
    if (align === 'right') return docx.AlignmentType.RIGHT;
    return docx.AlignmentType.LEFT;
  };
  const border = {
    style: docx.BorderStyle.SINGLE,
    size: 4,
    color: BORDER_COLOR,
  };
  return new docx.Table({
    width: { size: 100, type: docx.WidthType.PERCENTAGE },
    borders: {
      top: border,
      bottom: border,
      left: border,
      right: border,
      insideHorizontal: border,
      insideVertical: border,
    },
    rows: block.rows.map(
      (row, rowIndex) =>
        new docx.TableRow({
          tableHeader: rowIndex === 0,
          children: row.map(
            (cell, cellIndex) =>
              new docx.TableCell({
                ...(rowIndex === 0 && {
                  shading: {
                    type: docx.ShadingType.CLEAR,
                    fill: 'ECEFF4',
                    color: 'auto',
                  },
                }),
                children: [
                  new docx.Paragraph({
                    alignment: alignment(cellIndex),
                    children: toRuns(
                      docx,
                      rowIndex === 0
                        ? cell.map((run) =>
                            run.type === 'text' ? { ...run, bold: true } : run
                          )
                        : cell
                    ),
                  }),
                ],
              })
          ),
        })
    ),
  });
}

/**
 * リストを段落の並びにする（入れ子は段階を 1 つ深くする。項目の 2 つ目以降の段落は字下げだけ）。
 *
 * @param context - 変換の途中で受け継ぐもの
 * @param block - リストのブロック
 * @param level - 入れ子の段階（0 始まり）
 * @returns 段落・表の並び
 */
function toList(
  context: Context,
  block: Extract<DocBlock, { type: 'list' }>,
  level: number
): BodyElement[] {
  const { docx } = context;
  const instance = block.ordered ? context.nextListInstance() : 0;
  return block.items.flatMap((item) => {
    const [first, ...rest] = item.blocks;
    const checkbox =
      item.checked === null
        ? []
        : [new docx.TextRun(item.checked ? '☑ ' : '☐ ')];
    const firstRuns = first && first.type === 'paragraph' ? first.runs : [];
    const head = new docx.Paragraph({
      numbering: {
        reference: block.ordered ? ORDERED : BULLET,
        level: Math.min(level, 8),
        ...(block.ordered && { instance }),
      },
      children: [...checkbox, ...toRuns(docx, firstRuns)],
    });
    const remaining =
      first && first.type !== 'paragraph' ? [first, ...rest] : rest;
    return [
      head,
      ...remaining.flatMap((child) =>
        child.type === 'list'
          ? toList(context, child, level + 1)
          : toElements(context, [child], (level + 1) * 360)
      ),
    ];
  });
}

/**
 * 文書のブロックを、docx の段落・表の並びにする。
 *
 * @param context - 変換の途中で受け継ぐもの
 * @param blocks - ブロック
 * @param indent - 左の字下げ（twip。リストの項目・引用の中で使う）
 * @param quoted - 引用の中か（段落に左の罫線を付ける）
 * @returns 段落・表の並び
 */
function toElements(
  context: Context,
  blocks: DocBlock[],
  indent = 0,
  quoted = false
): BodyElement[] {
  const { docx } = context;
  const indentation = {
    ...(indent > 0 && { indent: { left: indent } }),
    // 引用の中の段落には左の罫線を付ける
    ...(quoted && {
      border: {
        left: {
          style: docx.BorderStyle.SINGLE,
          size: 12,
          color: BORDER_COLOR,
          space: 8,
        },
      },
    }),
  };
  return blocks.flatMap((block): BodyElement[] => {
    switch (block.type) {
      case 'heading':
        return [
          new docx.Paragraph({
            heading: headingLevel(docx, block.depth),
            children: toRuns(docx, block.runs),
          }),
        ];
      case 'paragraph':
        return [
          new docx.Paragraph({
            ...indentation,
            children: toRuns(docx, block.runs),
          }),
        ];
      case 'list':
        return toList(context, block, 0);
      case 'table':
        return [toTable(docx, block)];
      case 'code':
        return [
          new docx.Paragraph({
            ...indentation,
            shading: {
              type: docx.ShadingType.CLEAR,
              fill: CODE_SHADE,
              color: 'auto',
            },
            children: block.text.split('\n').map(
              (line, index) =>
                new docx.TextRun({
                  text: line,
                  font: CODE_FONT,
                  size: 19,
                  ...(index > 0 && { break: 1 }),
                })
            ),
          }),
        ];
      case 'quote':
        return toElements(context, block.blocks, indent + 360, true);
      case 'image':
        return [imageParagraph(docx, block.image)];
      case 'rule':
        return [
          new docx.Paragraph({
            border: {
              bottom: {
                style: docx.BorderStyle.SINGLE,
                size: 6,
                color: BORDER_COLOR,
                space: 1,
              },
            },
          }),
        ];
      case 'note':
        return [noteParagraph(docx, block.text)];
    }
  });
}

/**
 * 箇条書き・番号付きリストの numbering の定義を作る（段階 0〜8。段階ごとに 360 twip ずつ字下げ）。
 *
 * @param docx - docx の本体
 * @returns numbering の定義
 */
function numberingConfig(docx: typeof Docx) {
  const levels = (format: 'bullet' | 'ordered') =>
    Array.from({ length: 9 }, (_, level) => ({
      level,
      format:
        format === 'bullet'
          ? docx.LevelFormat.BULLET
          : docx.LevelFormat.DECIMAL,
      text:
        format === 'bullet' ? (level % 2 === 0 ? '•' : '◦') : `%${level + 1}.`,
      alignment: docx.AlignmentType.LEFT,
      style: {
        paragraph: { indent: { left: 360 * (level + 1), hanging: 260 } },
      },
    }));
  return [
    { reference: BULLET, levels: levels('bullet') },
    { reference: ORDERED, levels: levels('ordered') },
  ];
}

/**
 * 書き出しの文書を、Word の DOCX の文書にする。
 *
 * 表題・情報（書き出した日時・役割の名前）・役割の本文（引用）の後に、メッセージごとに見出し 1 と本文を並べる。
 * A4・余白 20mm・本文は游ゴシック（英数字は Calibri）。保存は呼び出し側が `Packer` で行う。
 *
 * @param docx - docx の本体（`import('docx')` の結果）
 * @param doc - 書き出しの文書
 * @returns docx の文書
 */
export function buildDocx(
  docx: typeof Docx,
  doc: ReportDocument
): Docx.Document {
  let listInstance = 0;
  const context: Context = {
    docx,
    nextListInstance: () => {
      listInstance += 1;
      return listInstance;
    },
  };
  const children: BodyElement[] = [
    new docx.Paragraph({
      heading: docx.HeadingLevel.TITLE,
      children: [new docx.TextRun(doc.title)],
    }),
    ...doc.meta.map(
      (line) =>
        new docx.Paragraph({
          children: [new docx.TextRun({ text: line, color: MUTED_COLOR })],
        })
    ),
    ...(doc.role
      ? toElements(context, [
          {
            type: 'quote',
            blocks: [
              {
                type: 'paragraph',
                runs: doc.role
                  .split('\n')
                  .flatMap((line, index) => [
                    ...(index > 0 ? [{ type: 'break' as const }] : []),
                    { type: 'text' as const, text: line },
                  ]),
              },
            ],
          },
        ])
      : []),
    ...doc.sections.flatMap((section) => [
      new docx.Paragraph({
        heading: docx.HeadingLevel.HEADING_1,
        children: [new docx.TextRun(section.heading)],
      }),
      ...toElements(context, section.blocks),
    ]),
  ];

  return new docx.Document({
    title: doc.title,
    creator: 'Nordic Chat',
    styles: {
      default: {
        document: { run: { font: BODY_FONT, size: 21 } },
      },
    },
    numbering: { config: numberingConfig(docx) },
    sections: [
      {
        properties: {
          page: {
            size: A4,
            margin: {
              top: MARGIN,
              bottom: MARGIN,
              left: MARGIN,
              right: MARGIN,
            },
          },
        },
        children,
      },
    ],
  });
}
