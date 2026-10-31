/**
 * Mermaid の図の文字のフォント。mermaid はページの中で文字の幅を測って枠の大きさを決めるが、`<img>` の中では
 * Web フォント（Geist）が使えない。測る側と描く側を揃えるため、本文の `font-family` から Geist を除いたものにする。
 * 画面の図（`useMermaidDiagram`）とレポートの図（#36。`useReportExport`）で揃える。
 */
export const DIAGRAM_FONT_FAMILY = 'Arial, Helvetica, sans-serif';

/** PlantUML の図を描かせる API（#171）。画面の図（`usePlantUmlDiagram`）とレポートの図（#36）で使う */
export const PLANTUML_API = '/api/diagrams/plantuml';
