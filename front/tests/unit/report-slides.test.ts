import { describe, it, expect } from 'vitest';
import type { RenderedDiagrams } from '@/lib/chat/report-html';
import { buildReportHtml, diagramKey } from '@/lib/chat/report-html';
import type { SlidesInput } from '@/lib/chat/report-slides';
import { buildSlidesHtml } from '@/lib/chat/report-slides';

/**
 * HTML スライド（#36。`docs/26-html-slides-export.md`）の組み立ての UT。外部 I/O が無いため mock は使わない。
 * 分け方そのものは `slides.test.ts`、ここでは HTML の中身（枚数・ページ番号・表紙・安全策・図）を見る。
 */

const NO_DIAGRAMS: RenderedDiagrams = new Map();
const SVG_URI = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';

/**
 * スライドにする応答を作る。
 *
 * @param overrides - 変える項目
 * @returns スライドにする応答
 */
const input = (overrides: Partial<SlidesInput> = {}): SlidesInput => ({
  title: '提案のまとめ',
  content: '# 提案\n\n副題\n\n---\n\n## 背景\n\n- 1\n- 2\n',
  interrupted: false,
  ...overrides,
});

/**
 * スライドの HTML から、スライドの `<section>` の開きタグを取り出す。
 *
 * @param html - スライドの HTML
 * @returns スライドの開きタグ（現れた順）
 */
const sectionTags = (html: string): string[] =>
  html.match(/<section [^>]*>/g) ?? [];

describe('buildSlidesHtml', () => {
  describe('正常系', () => {
    it('1 ファイルの HTML で、区切り線ごとのスライドにページ番号を書き込む', () => {
      const html = buildSlidesHtml(input(), NO_DIAGRAMS);
      expect(html.startsWith('<!doctype html>')).toBe(true);
      expect(html).toContain('<title>提案のまとめ</title>');
      expect(sectionTags(html)).toEqual([
        '<section class="slide cover" id="slide-1">',
        '<section class="slide" id="slide-2">',
      ]);
      expect(html).toContain('<span class="slide-number">1 / 2</span>');
      expect(html).toContain('<span class="slide-number">2 / 2</span>');
      expect(html).toContain('<span class="slide-title">提案のまとめ</span>');
      expect(html).toContain('scroll-snap-type: y mandatory');
    });

    it('区切り線が無ければ見出しで分ける', () => {
      const html = buildSlidesHtml(
        input({ content: '## A\n\n本文\n\n### a1\n\n## B\n\n本文' }),
        NO_DIAGRAMS
      );
      expect(sectionTags(html)).toHaveLength(2);
      expect(html).toContain('<span class="slide-number">2 / 2</span>');
    });

    it('コードは HTML レポートと同じく色付けのクラスが付き、描けた図は <img> になる', () => {
      const source = 'graph TD\n  A-->B';
      const diagrams: RenderedDiagrams = new Map([
        [diagramKey('mermaid', source), SVG_URI],
      ]);
      const html = buildSlidesHtml(
        input({
          content: `## コード\n\n\`\`\`ts\nconst a = 1;\n\`\`\`\n\n## 図\n\n\`\`\`mermaid\n${source}\n\`\`\``,
        }),
        diagrams
      );
      expect(html).toContain('hljs-keyword');
      expect(html).toContain(`<img src="${SVG_URI}" alt="mermaid の図">`);
    });

    it('先頭の front matter と、コメントだけの生の HTML（Marp の指示）は出さない', () => {
      const html = buildSlidesHtml(
        input({
          content:
            '---\nmarp: true\n---\n\n<!-- _class: lead -->\n\n# 題\n\n---\n\n## A\n\n本文 <!-- メモ -->',
        }),
        NO_DIAGRAMS
      );
      expect(html).not.toContain('marp: true');
      expect(html).not.toContain('_class');
      expect(html).not.toContain('メモ');
      expect(sectionTags(html)).toHaveLength(2);
    });
  });

  describe('準正常系', () => {
    it('本文が空なら、会話のタイトルの表紙を 1 枚にする', () => {
      const html = buildSlidesHtml(input({ content: '' }), NO_DIAGRAMS);
      expect(sectionTags(html)).toEqual([
        '<section class="slide cover" id="slide-1">',
      ]);
      expect(html).toContain('<h1>提案のまとめ</h1>');
      expect(html).toContain('<span class="slide-number">1 / 1</span>');
    });

    it('中断した応答は、最後のスライドに注記を付ける', () => {
      const html = buildSlidesHtml(input({ interrupted: true }), NO_DIAGRAMS);
      const last = html.slice(html.indexOf('id="slide-2"'));
      expect(last).toContain('（生成を中断した応答）');
      expect(html.indexOf('（生成を中断した応答）')).toBeGreaterThan(
        html.indexOf('id="slide-2"')
      );
    });

    it('タイトルが空白だけなら「無題の会話」にする（レポートと同じ）', () => {
      const html = buildSlidesHtml(input({ title: '  ' }), NO_DIAGRAMS);
      const report = buildReportHtml(
        {
          mode: 'message',
          title: '  ',
          exportedAt: new Date(),
          systemPrompt: null,
          messages: [],
        },
        NO_DIAGRAMS
      );
      const titleOf = (doc: string) => /<title>(.*)<\/title>/.exec(doc)?.[1];
      expect(titleOf(html)).toBe(titleOf(report));
    });
  });

  describe('異常系', () => {
    it('タイトルの HTML はエスケープし、本文の生の HTML は文字にし、スクリプトを入れない', () => {
      const html = buildSlidesHtml(
        input({
          title: '<script>alert(1)</script>',
          content:
            '## A\n\n<script>alert(2)</script>\n\n<img src=x onerror=alert(3)>',
        }),
        NO_DIAGRAMS
      );
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toMatch(/<img src="?x/);
      expect(html).toContain('&#x3C;script>alert(2)&#x3C;/script>');
    });

    it('危ない URL のリンクは外し、本文の画像は埋め込まない', () => {
      const html = buildSlidesHtml(
        input({
          content:
            '## A\n\n[押す](javascript:alert(1))\n\n![外部](https://example.com/a.png)',
        }),
        NO_DIAGRAMS
      );
      expect(html).not.toContain('javascript:');
      expect(html).not.toContain('<img src="https://example.com');
      expect(html).toContain(
        '<a href="https://example.com/a.png">［画像: 外部］</a>'
      );
    });

    it('コメントに見えても、ほかの生の HTML が混ざれば文字として出す', () => {
      const html = buildSlidesHtml(
        input({ content: '## A\n\n<!-- メモ --><b>太字</b>' }),
        NO_DIAGRAMS
      );
      expect(html).toContain('&#x3C;b>太字&#x3C;/b>');
    });
  });
});
