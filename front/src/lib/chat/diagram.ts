/** Mermaid のコードフェンスの言語名（小文字で比べる） */
const MERMAID_LANGUAGE = 'mermaid';

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
 * コードフェンスの言語名が Mermaid か判定する（大文字小文字は区別しない）。
 *
 * @param language - `getCodeLanguage` が返した言語名。指定なしは `null`
 * @returns Mermaid の図として描くブロックなら `true`
 */
export function isMermaidLanguage(language: string | null): boolean {
  return language?.toLowerCase() === MERMAID_LANGUAGE;
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
