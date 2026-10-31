import { MARKDOWN_STYLE } from '@/lib/chat/report-style';

/**
 * HTML スライド（#36。`docs/26-html-slides-export.md`「スライドの見た目と操作」）に埋め込む CSS。
 *
 * 本文は HTML レポートと同じ {@link MARKDOWN_STYLE} で整形し、その後ろでスライド向けに文字・見出しを大きくする
 * （同じ詳細度のため、後ろに書いた方が勝つ）。スクリプトを入れないため、ページ送りは scroll-snap で 1 枚ずつ止める。
 * 1 枚は画面いっぱいで、収まらないスライドは縮めずに縦へ伸ばす。印刷では 16:9 の横長の 1 ページに 1 枚を置く。
 */
export const SLIDES_STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
html { scroll-snap-type: y mandatory; }
body {
  margin: 0;
  background: #d8dee9;
  color: #2e3440;
  font-family: system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", sans-serif;
  line-height: 1.6;
}
.slide {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 100vh;
  padding: 6vh 6vw 10vh;
  background: #ffffff;
  border-bottom: 2px solid #d8dee9;
  scroll-snap-align: start;
  font-size: clamp(16px, 2vw, 32px);
}
.slide-body { width: 100%; max-width: 46em; margin: 0 auto; }
${MARKDOWN_STYLE}
.slide-body h1, .slide-body h2, .slide-body h3 { line-height: 1.3; }
.slide-body h1 { font-size: 2em; }
.slide-body h2 { font-size: 1.6em; border-bottom: 3px solid #88c0d0; padding-bottom: 0.2em; }
.slide-body h3 { font-size: 1.25em; color: #3b4252; }
.slide-body li + li { margin-top: 0.3em; }
.slide-body img, .slide-body figure.diagram img { max-height: 70vh; width: auto; max-width: 100%; }
.slide-body pre code { font-size: 0.75em; }
.slide.cover { text-align: center; background: linear-gradient(160deg, #ffffff 55%, #e5e9f0); }
.slide.cover .slide-body h1 { font-size: 2.6em; color: #2e3440; }
.slide.cover .slide-body h2 { border-bottom: none; color: #5e81ac; }
.slide.cover .slide-body p { color: #4c566a; }
.slide-footer {
  position: absolute;
  left: 6vw;
  right: 6vw;
  bottom: 3vh;
  display: flex;
  justify-content: space-between;
  gap: 1em;
  font-size: 0.5em;
  color: #4c566a;
}
.slide-footer .slide-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.slide-footer .slide-number { flex-shrink: 0; font-variant-numeric: tabular-nums; }
@page { size: 13.333in 7.5in; margin: 0; }
@media print {
  html { scroll-snap-type: none; }
  body { background: #ffffff; }
  .slide { min-height: 7.5in; padding: 0.5in 0.8in 0.7in; border-bottom: none; font-size: 22px; break-after: page; }
  .slide:last-child { break-after: auto; }
  .slide-footer { left: 0.8in; right: 0.8in; bottom: 0.25in; }
  .slide-body img, .slide-body figure.diagram img { max-height: 5in; }
  pre, figure.diagram, table, img { break-inside: avoid; }
  .slide-body pre { white-space: pre-wrap; word-break: break-all; overflow-x: visible; }
}
`;
