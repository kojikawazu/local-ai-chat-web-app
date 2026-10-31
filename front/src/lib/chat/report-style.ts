/**
 * 書き出しの本文（Markdown を整形した要素・図・コードの色付け・注記）の CSS。HTML レポートとスライド（#36）で共有する。
 *
 * 紙・PDF にしても読めるよう明るい背景向けにし、Nord の青（`#5e81ac`・`#88c0d0`）をアクセントに使う。
 * コードの色は rehype-highlight（highlight.js）のクラスに合わせる（画面の色はテーマの CSS 変数で、
 * 書き出しは 1 ファイルで完結させるため、ここに明るい背景向けの色を直接書く）。本文は `.markdown` の中に置く。
 */
export const MARKDOWN_STYLE = `
.note { color: #6b7280; font-style: italic; font-size: 0.9em; }
.markdown > :first-child { margin-top: 0; }
.markdown h1, .markdown h2, .markdown h3, .markdown h4 { line-height: 1.4; margin: 1.6em 0 0.6em; }
.markdown h1 { font-size: 1.5em; }
.markdown h2 { font-size: 1.3em; border-bottom: 1px solid #d8dee9; padding-bottom: 4px; }
.markdown h3 { font-size: 1.15em; }
.markdown a { color: #5e81ac; }
.markdown blockquote { margin: 1em 0; padding: 4px 16px; border-left: 4px solid #d8dee9; color: #4c566a; }
blockquote { margin: 1em 0; padding: 4px 16px; border-left: 4px solid #d8dee9; color: #4c566a; }
.markdown code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.9em;
  background: #eceff4;
  border-radius: 4px;
  padding: 0.15em 0.4em;
}
.markdown pre {
  background: #f6f8fa;
  border: 1px solid #d8dee9;
  border-radius: 6px;
  padding: 12px 16px;
  overflow-x: auto;
  line-height: 1.5;
}
.markdown pre code { background: none; padding: 0; font-size: 0.85em; }
.markdown table { border-collapse: collapse; margin: 1em 0; display: block; overflow-x: auto; }
.markdown th, .markdown td { border: 1px solid #d8dee9; padding: 6px 12px; }
.markdown th { background: #eceff4; }
.markdown img, figure.diagram img { max-width: 100%; height: auto; }
figure.diagram { margin: 1em 0; text-align: center; }
hr { border: none; border-top: 1px solid #d8dee9; margin: 2em 0; }
.hljs-comment, .hljs-quote { color: #6a737d; font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-name, .hljs-section, .hljs-doctag { color: #5e81ac; font-weight: 600; }
.hljs-built_in, .hljs-type, .hljs-title.class_, .hljs-attr, .hljs-attribute, .hljs-property, .hljs-selector-class, .hljs-selector-id { color: #8f5a00; }
.hljs-title, .hljs-title.function_ { color: #6f42c1; }
.hljs-string, .hljs-addition { color: #22863a; }
.hljs-number { color: #b5490f; }
.hljs-regexp, .hljs-symbol, .hljs-bullet, .hljs-link, .hljs-template-tag { color: #b5490f; }
.hljs-meta, .hljs-variable.language_ { color: #a3337a; }
.hljs-deletion { color: #b31d28; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: 700; }
`;

/**
 * HTML のレポート（#36。`docs/24-html-report-export.md`「レポートの中身と見た目」）に埋め込む CSS。
 *
 * ページの枠（タイトル・メッセージの見出し・添付画像）に、本文の {@link MARKDOWN_STYLE} を合わせる。
 * 印刷では A4・余白 16mm にし、コード・図・画像・表の途中で改ページしない。
 */
export const REPORT_STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0;
  background: #ffffff;
  color: #2e3440;
  font-family: system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", sans-serif;
  font-size: 15px;
  line-height: 1.75;
}
main { max-width: 48em; margin: 0 auto; padding: 40px 24px 64px; }
header { border-bottom: 3px solid #5e81ac; padding-bottom: 16px; margin-bottom: 32px; }
h1 { font-size: 1.8em; line-height: 1.3; margin: 0 0 8px; }
.meta { margin: 0; color: #4c566a; font-size: 0.9em; }
.role { margin: 12px 0 0; white-space: pre-wrap; }
.message { margin: 0 0 32px; }
.message > h2 {
  font-size: 0.95em;
  margin: 0 0 12px;
  padding: 4px 12px;
  border-left: 4px solid #88c0d0;
  background: #eceff4;
  color: #3b4252;
}
.message.user > h2 { border-left-color: #5e81ac; }
.plain { white-space: pre-wrap; margin: 0; }
.images { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.images img { max-width: 100%; height: auto; max-height: 360px; border: 1px solid #d8dee9; border-radius: 6px; }
${MARKDOWN_STYLE}
@page { size: A4; margin: 16mm; }
@media print {
  main { max-width: none; padding: 0; }
  pre, figure.diagram, .images, table, img { break-inside: avoid; }
  .message > h2 { break-after: avoid; }
  .markdown pre { white-space: pre-wrap; word-break: break-all; overflow-x: visible; }
}
`;
