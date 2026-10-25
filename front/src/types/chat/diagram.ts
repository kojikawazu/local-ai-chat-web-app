/**
 * 図として描くコードブロックの種類（#169・#171）。コードフェンスの言語名から `getDiagramKind` で判定する。
 */
export const DIAGRAM_KINDS = ['mermaid', 'plantuml'] as const;
/** 図として描くコードブロックの種類 */
export type DiagramKind = (typeof DIAGRAM_KINDS)[number];

/**
 * 図の描画の状態。描画のフック（`useMermaidDiagram`・`usePlantUmlDiagram`）が返し、`DiagramView` が表示する。
 *
 * - `idle`: ソースを表示する（生成中・空・描画待ち）
 * - `rendered`: 図を表示する。`src` は SVG の data: URI、`svg` は保存（#176）に使う SVG の文字列
 * - `error`: ソースと、描けなかった理由を表示する
 */
export type DiagramState =
  | { status: 'idle' }
  | { status: 'rendered'; src: string; svg: string }
  | { status: 'error'; error: string };
