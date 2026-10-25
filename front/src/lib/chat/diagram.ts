import type { DiagramKind, DiagramState } from '@/types/chat/diagram';

/** 図として描くコードフェンスの言語名（小文字で比べる）と、その種類 */
const DIAGRAM_LANGUAGES: Record<string, DiagramKind> = {
  mermaid: 'mermaid',
  plantuml: 'plantuml',
  puml: 'plantuml',
};

/** PlantUML の API が想定外の応答を返したときのメッセージ */
const PLANTUML_UNEXPECTED_RESPONSE_ERROR =
  'PlantUML の図を受け取れませんでした';

/** mermaid の `render` に渡す SVG の要素 ID の接頭辞 */
const MERMAID_ID_PREFIX = 'mermaid-';

/** SVG を `<img>` に入れる data: URI の接頭辞 */
const SVG_DATA_URI_PREFIX = 'data:image/svg+xml;charset=utf-8,';

/**
 * mermaid の `themeVariables` と、その値を読むテーマの CSS 変数の対応（#169）。
 * 対応の根拠は `docs/11-syntax-highlight-diagrams.md` の「配色（テーマ対応）」。
 */
const MERMAID_THEME_VARIABLES = {
  background: '--color-nord-0',
  primaryColor: '--color-nord-2',
  primaryBorderColor: '--color-nord-frost-1',
  primaryTextColor: '--color-nord-6',
  textColor: '--color-nord-6',
  lineColor: '--color-nord-frost-2',
  secondaryColor: '--color-nord-1',
  tertiaryColor: '--color-nord-3',
  noteBkgColor: '--color-nord-aurora-yellow',
  noteTextColor: '--color-nord-0',
  errorBkgColor: '--color-nord-aurora-red',
} as const;

/**
 * コードフェンスの言語名から、図として描くブロックの種類を判定する（大文字小文字は区別しない）。
 *
 * @param language - `getCodeLanguage` が返した言語名。指定なしは `null`
 * @returns `mermaid`、`plantuml`（`puml` も含む）のどちらか。図として描かないブロックは `null`
 */
export function getDiagramKind(language: string | null): DiagramKind | null {
  if (!language) return null;
  // Object.hasOwn で `constructor` 等の継承したプロパティ名を図の種類と取り違えない
  const key = language.toLowerCase();
  return Object.hasOwn(DIAGRAM_LANGUAGES, key) ? DIAGRAM_LANGUAGES[key] : null;
}

/**
 * React の `useId` の値から、mermaid の `render` に渡せる要素 ID を作る。
 *
 * `useId` の値は `:` や `«»` などの記号を含み、mermaid が ID を CSS セレクタに使うと
 * 壊れるため、英数字だけを残す。同じ React ツリーの `useId` は英数字の部分で区別されるため、
 * 記号を落としても重ならない。
 *
 * @param reactId - `useId` が返した値
 * @returns `mermaid-` で始まる、英数字だけの ID
 */
export function toMermaidId(reactId: string): string {
  return MERMAID_ID_PREFIX + reactId.replace(/[^a-zA-Z0-9]/g, '');
}

/**
 * SVG の文字列を `<img src>` に入れる data: URI にする。
 *
 * `#`・`%`・改行・日本語を含んでも壊れないよう、全体を `encodeURIComponent` する
 * （base64 より短く、`decodeURIComponent` で元に戻せる）。
 *
 * @param svg - SVG の文字列
 * @returns `data:image/svg+xml` の URI
 */
export function svgToDataUri(svg: string): string {
  return SVG_DATA_URI_PREFIX + encodeURIComponent(svg);
}

/**
 * ルートの `<svg>` に、`viewBox` の大きさを `width` / `height` として書き込む。
 *
 * mermaid は `width="100%"` と `style="max-width: …"` で SVG を出すが、`<img>` に入れると
 * 画像の元の大きさが決まらず、既定の 300×150 で描かれる。`viewBox` の幅・高さを入れれば、
 * 元の大きさで表示し、`max-width: 100%` で縮められる。`viewBox` が無ければそのまま返す。
 *
 * @param svg - mermaid が返した SVG の文字列
 * @returns ルートの `<svg>` の大きさを書き込んだ SVG の文字列
 */
export function withIntrinsicSize(svg: string): string {
  const openTag = svg.match(/<svg\b[^>]*>/)?.[0];
  if (!openTag) return svg;

  // viewBox="min-x min-y width height"（区切りは空白またはカンマ）
  const viewBox = openTag
    .match(/\sviewBox="([^"]*)"/)?.[1]
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (!viewBox || viewBox.length !== 4) return svg;
  const [, , width, height] = viewBox;
  if (!(width > 0 && height > 0)) return svg;

  const sized = openTag
    .replace(/\s(width|height)="[^"]*"/g, '')
    .replace(/\sstyle="[^"]*"/, '')
    .replace(/^<svg\b/, `<svg width="${width}" height="${height}"`);
  // 置き換え後の文字列の `$&` 等を置換パターンとして解釈させないよう、関数で渡す
  return svg.replace(openTag, () => sized);
}

/**
 * テーマの CSS 変数から、mermaid の `themeVariables` を組み立てる。
 *
 * 値が空（そのテーマで未定義）の変数は入れず、mermaid の既定（`base` テーマからの導出）に任せる。
 *
 * @param readVariable - CSS 変数名を受け取り、その値を返す関数（ブラウザでは
 *   `getComputedStyle(document.documentElement).getPropertyValue`）
 * @returns mermaid の `themeVariables` に渡すオブジェクト
 */
export function buildMermaidThemeVariables(
  readVariable: (name: string) => string
): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [key, cssVariable] of Object.entries(MERMAID_THEME_VARIABLES)) {
    const value = readVariable(cssVariable).trim();
    if (value) variables[key] = value;
  }
  return variables;
}

/**
 * `POST /api/diagrams/plantuml` の応答を、図の描画の状態にする（#171）。
 *
 * 応答の型は信用しない。成功で `svg` が文字列なら data: URI にし、失敗で `error` が文字列ならそれを使う。
 * それ以外（JSON でない・形が違う）は想定外の応答として扱う。
 *
 * @param ok - 応答が 2xx だったか
 * @param json - 応答の本文を `JSON.parse` した値。JSON でなければ `null`
 * @returns `rendered`（`src` は SVG の data: URI、`svg` は受け取った SVG）か `error`
 */
export function toPlantUmlDiagramState(
  ok: boolean,
  json: unknown
): DiagramState {
  const body =
    typeof json === 'object' && json !== null
      ? // object であることは上で確認済み。各プロパティを unknown のまま取り出して下で検証するための型付け
        (json as Record<string, unknown>)
      : {};
  if (ok && typeof body.svg === 'string' && body.svg) {
    return { status: 'rendered', src: svgToDataUri(body.svg), svg: body.svg };
  }
  if (!ok && typeof body.error === 'string' && body.error) {
    return { status: 'error', error: body.error };
  }
  return { status: 'error', error: PLANTUML_UNEXPECTED_RESPONSE_ERROR };
}

/**
 * 拡大のダイアログの倍率の段階（#176）。`−` / `+` でこの段階を前後に移る。
 * 100% を中心に、縮小は 25% 刻み、拡大は読みやすさが変わる程度に間を広げる。
 */
const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const;

/** 倍率を段階と比べるときの誤差の許容（「全体」の倍率が計算で段階とほぼ同じになった場合を同じとみなす） */
const ZOOM_EPSILON = 1e-6;

/** PNG にするときの、図の元の大きさに対する倍率（高解像度の画面で粗くならないように） */
const PNG_SCALE = 2;

/** PNG の長辺の上限（px）。ブラウザの `<canvas>` の上限に当たると `toBlob` が `null` を返すため、それより小さく抑える */
const MAX_PNG_SIDE = 8192;

/** 拡大・縮小の向き */
type ZoomDirection = 'in' | 'out';

/**
 * 今の倍率から、1 つ大きい（`in`）／小さい（`out`）倍率の段階を返す（#176）。
 *
 * 今の倍率は段階の値でなくてよい（「全体」で縮めて表示しているときの倍率など）。その場合も、
 * 今より大きい／小さい最も近い段階へ移る。
 *
 * @param scale - 今の倍率（1 が元の大きさ）
 * @param direction - `in` で拡大、`out` で縮小
 * @returns 次の倍率。それ以上拡大／縮小できなければ `null`
 */
export function stepZoom(
  scale: number,
  direction: ZoomDirection
): number | null {
  if (direction === 'in') {
    return ZOOM_LEVELS.find((level) => level > scale + ZOOM_EPSILON) ?? null;
  }
  return ZOOM_LEVELS.findLast((level) => level < scale - ZOOM_EPSILON) ?? null;
}

/**
 * 属性値に入れる文字列の `&`・`"`・`<` を文字参照にする。
 *
 * @param value - 属性値に入れる文字列
 * @returns エスケープした文字列
 */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

/**
 * SVG の長さの属性（`width="800"`・`width="800px"`）を数にする。
 *
 * @param openTag - ルートの `<svg>` の開始タグ
 * @param name - 属性名
 * @returns 正の数。無い・単位が px 以外（`100%` 等）・不正な値なら `null`
 */
function readLength(openTag: string, name: 'width' | 'height'): number | null {
  const value = openTag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]?.trim();
  if (!value || !/^\d+(\.\d+)?(px)?$/.test(value)) return null;
  const length = parseFloat(value);
  return length > 0 ? length : null;
}

/**
 * SVG の全体を塗る背景の `<rect>` を、ルートの `<svg>` の先頭に足す（#176）。
 *
 * Mermaid の SVG は背景が透明で、文字の色はテーマの明るい色のため、白い地のビューアで開くと読めない。
 * 保存するときに画面と同じ地の色を付ける。塗る範囲は `viewBox`（原点が 0 でない場合も含む）、
 * 無ければ `width` / `height`。どちらも無い・ルートが空要素のときは、そのまま返す。
 *
 * @param svg - SVG の文字列
 * @param color - 背景の色（CSS の色の値。例: `#2e3440`）
 * @returns 背景の `<rect>` を足した SVG の文字列
 */
export function withBackground(svg: string, color: string): string {
  const openTag = svg.match(/<svg\b[^>]*>/)?.[0];
  if (!openTag || openTag.endsWith('/>')) return svg;

  const viewBox = openTag
    .match(/\sviewBox="([^"]*)"/)?.[1]
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  let box: [number, number, number, number] | null = null;
  if (
    viewBox?.length === 4 &&
    viewBox.every(Number.isFinite) &&
    viewBox[2] > 0 &&
    viewBox[3] > 0
  ) {
    box = [viewBox[0], viewBox[1], viewBox[2], viewBox[3]];
  } else {
    const width = readLength(openTag, 'width');
    const height = readLength(openTag, 'height');
    if (width && height) box = [0, 0, width, height];
  }
  if (!box) return svg;

  const [x, y, width, height] = box;
  const rect = `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${escapeAttribute(color.trim())}"/>`;
  // 置き換え後の文字列の `$&` 等を置換パターンとして解釈させないよう、関数で渡す
  return svg.replace(openTag, () => openTag + rect);
}

/**
 * 図を PNG にするときの画像の大きさを決める（#176）。
 *
 * 元の大きさの {@link PNG_SCALE} 倍にする。長辺が {@link MAX_PNG_SIDE} を超えるなら、収まるまで倍率を下げる。
 *
 * @param width - 図の元の幅（px。`<img>` の `naturalWidth`）
 * @param height - 図の元の高さ（px）
 * @returns PNG の幅・高さ（整数の px）。元の大きさが正の有限の数でなければ `null`
 */
export function getPngSize(
  width: number,
  height: number
): { width: number; height: number } | null {
  if (![width, height].every((n) => Number.isFinite(n) && n > 0)) return null;
  const scale = Math.min(PNG_SCALE, MAX_PNG_SIDE / Math.max(width, height));
  return {
    width: Math.min(MAX_PNG_SIDE, Math.ceil(width * scale)),
    height: Math.min(MAX_PNG_SIDE, Math.ceil(height * scale)),
  };
}
