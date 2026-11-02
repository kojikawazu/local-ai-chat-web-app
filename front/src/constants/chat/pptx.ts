/**
 * PPTX の書き出し（#36。`docs/27-pptx-export.md`「スライドの割り付け」）の寸法。割り付け（`lib/chat/pptx-layout.ts`）と
 * pptxgenjs の図形にする側（`lib/chat/report-pptx.ts`）の両方で使う。単位はインチ（pptxgenjs の単位）。
 */

/** スライドの大きさ（16:9。PowerPoint の「ワイド画面」と同じ 13.333 × 7.5） */
export const PPTX_SLIDE_SIZE = { width: 13.333, height: 7.5 } as const;

/** 左右の余白 */
export const PPTX_SIDE_MARGIN = 0.6;

/** スライドのタイトルの枠（上 0.4・高さ 1.0。下に本文が 1.6 から始まる） */
export const PPTX_TITLE_RECT = {
  x: PPTX_SIDE_MARGIN,
  y: 0.4,
  w: PPTX_SLIDE_SIZE.width - PPTX_SIDE_MARGIN * 2,
  h: 1.0,
} as const;

/** 引用の左の四角の幅と、テキストまでの空き */
export const PPTX_QUOTE_BAR = { width: 0.06, gap: 0.15 } as const;

/**
 * 行の間隔（文字の大きさに対する倍率）。PowerPoint には pt の固定の間隔（文字の大きさ × この倍率）で渡す。
 * フォントの既定の行の高さ（游ゴシックは広い）に任せると、割り付けの高さの見積もりと実際の高さがずれるため
 */
export const PPTX_LINE_SPACING = 1.4;

/** 表のセルの内側の余白（左右・上下） */
export const PPTX_CELL_INSET = { x: 0.1, y: 0.06 } as const;
