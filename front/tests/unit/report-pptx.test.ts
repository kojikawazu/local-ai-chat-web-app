import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import type { DiagramImages } from '@/lib/chat/document-model';
import { layoutPptx } from '@/lib/chat/pptx-layout';
import { diagramKey } from '@/lib/chat/report-html';
import { buildPptx } from '@/lib/chat/report-pptx';

/**
 * 割り付け → PPTX（#36。`report-pptx.ts`）の UT。
 *
 * node の pptxgenjs で実際に PPTX を作り、`jszip` で中のスライドの XML を読んで、PowerPoint の部品になっていることを
 * 確かめる（外部 I/O は無い。pptxgenjs は差し替えずに本物を使う）。
 */

/** zip の中のスライドのファイル（`ppt/slides/slide3.xml`） */
const SLIDE_FILE = /^ppt\/slides\/slide(\d+)\.xml$/;

/** zip の中の、埋め込んだ画像のファイル */
const MEDIA_FILE = /^ppt\/media\/[^/]+\.(?:png|jpe?g)$/;

/** 1×1 の PNG のバイト列 */
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  ),
  (c) => c.charCodeAt(0)
);

/** 図の Mermaid のソース */
const MERMAID = 'graph TD; A-->B';

/**
 * 応答から PPTX を作り、中のファイルを読む。
 *
 * @param content - 応答の Markdown
 * @param diagrams - 描けた図
 * @returns スライドの XML（番号順）・スライドの関係（リンク先）の XML・zip の中のファイル名・スライドのレイアウトの XML
 */
async function render(content: string, diagrams: DiagramImages = new Map()) {
  const pres = buildPptx(
    PptxGenJS,
    layoutPptx({ title: '旅行の計画', content, interrupted: false }, diagrams)
  );
  // write の戻り値の型は出力の形ごとの和。'nodebuffer' を渡したときは Buffer を返す（pptxgenjs の README）
  const buffer = (await pres.write({ outputType: 'nodebuffer' })) as Buffer;
  const zip = await JSZip.loadAsync(buffer);
  const files = Object.keys(zip.files);
  const read = async (name: string) =>
    (await zip.file(name)?.async('string')) ?? '';
  const slideNames = files
    .flatMap((name) => {
      const match = SLIDE_FILE.exec(name);
      return match ? [{ name, index: Number(match[1]) }] : [];
    })
    .sort((a, b) => a.index - b.index);
  return {
    files,
    slides: await Promise.all(slideNames.map(({ name }) => read(name))),
    rels: await Promise.all(
      slideNames.map(({ index }) =>
        read(`ppt/slides/_rels/slide${index}.xml.rels`)
      )
    ),
    layouts: (
      await Promise.all(
        files
          .filter((name) => /^ppt\/slideLayouts\/[^/]+\.xml$/.test(name))
          .map(read)
      )
    ).join('\n'),
  };
}

/** スライド番号の欄（各スライドに pptxgenjs が置く。中の文字は PowerPoint が番号に置き換える） */
const SLIDE_NUMBER_FIELD =
  /<a:fld [^>]*type="slidenum"[^>]*>[\s\S]*?<\/a:fld>/g;

/**
 * スライドの XML の文字（`<a:t>`）を、現れた順に取り出す（スライド番号の欄は除く）。
 *
 * @param xml - スライドの XML
 * @returns 文字の並び
 */
const textsOf = (xml: string) =>
  [...xml.replace(SLIDE_NUMBER_FIELD, '').matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(
    (m) => m[1]
  );

describe('buildPptx', () => {
  describe('正常系', () => {
    it('スライドを分け、表紙と各スライドのタイトルをタイトルの位置に入れる', async () => {
      const { slides } = await render(
        '# 旅のしおり\n\n3 日間\n\n---\n\n## 1 日目\n\n- 京都\n\n---\n\n## 2 日目\n\n- 奈良'
      );
      expect(slides).toHaveLength(3);
      expect(slides[0]).toContain('type="title"');
      expect(textsOf(slides[0])).toEqual(['旅のしおり', '3 日間']);
      expect(slides[1]).toContain('type="title"');
      expect(textsOf(slides[1])).toEqual(['1 日目', '京都']);
      expect(textsOf(slides[2])).toEqual(['2 日目', '奈良']);
    });

    it('フッターに会話のタイトルとスライド番号を置く（スライドのレイアウト）', async () => {
      const { layouts } = await render('## A\n\n- x');
      expect(layouts).toContain('旅行の計画');
      expect(layouts).toContain('type="sldNum"');
    });

    it('箇条書き・入れ子・番号付き・タスクの記号にする（記号は文字参照で書かれる）', async () => {
      const { slides } = await render(
        '## L\n\n- 点\n  - 入れ子\n\n1. 一\n2. 二\n\n- [x] 済み'
      );
      expect(slides[0]).toContain('<a:buChar char="&#x2022;"/>');
      expect(slides[0]).toContain('lvl="1"');
      expect(slides[0]).toContain(
        '<a:buAutoNum type="arabicPeriod" startAt="1"/>'
      );
      expect(slides[0]).not.toContain('startAt="2"');
      expect(slides[0]).toContain('<a:buChar char="&#x2611;"/>');
    });

    it('段落・コードは固定の行の間隔（文字の大きさ × 1.4）にする', async () => {
      const { slides } = await render('## A\n\n- 点\n\n```\ncode\n```');
      expect(slides[0]).toContain('<a:spcPts val="2520"/>');
      expect(slides[0]).toContain('<a:spcPts val="1820"/>');
    });

    it('表・コード（等幅）・強調を PowerPoint の部品にする', async () => {
      const { slides } = await render(
        '## T\n\n| 列 | 値 |\n|---|---|\n| a | 1 |\n\n```\nconst a = 1;\n```\n\n**太字** と `code`'
      );
      expect(slides[0]).toContain('<a:tbl>');
      expect(textsOf(slides[0])).toEqual(
        expect.arrayContaining(['列', '値', 'a', '1', 'const a = 1;', '太字'])
      );
      expect(slides[0]).toContain('typeface="Consolas"');
      expect(slides[0]).toContain('b="1"');
    });

    it('安全なリンクはハイパーリンクにする', async () => {
      const { rels } = await render('## A\n\n[案内](https://example.com/a)');
      expect(rels[0]).toContain('Target="https://example.com/a"');
    });

    it('描けた図は画像として埋め込む', async () => {
      const diagrams: DiagramImages = new Map([
        [
          diagramKey('mermaid', MERMAID),
          {
            data: PNG,
            mimeType: 'image/png',
            width: 1,
            height: 1,
            alt: '図',
          },
        ],
      ]);
      const { files, slides } = await render(
        `## 図\n\n\`\`\`mermaid\n${MERMAID}\n\`\`\``,
        diagrams
      );
      expect(files.filter((name) => MEDIA_FILE.test(name))).toHaveLength(1);
      expect(slides[0]).toContain('<p:pic>');
    });

    it('長いリストは続きのスライドに分かれ、タイトルに（続き）が付く', async () => {
      const items = Array.from({ length: 30 }, (_, i) => `- 項目 ${i}`);
      const { slides } = await render(`## 手順\n\n${items.join('\n')}`);
      expect(slides.length).toBeGreaterThan(1);
      expect(textsOf(slides[1])[0]).toBe('手順（続き）');
    });
  });

  describe('準正常系', () => {
    it('本文が空なら、会話のタイトルの表紙 1 枚にする', async () => {
      const { slides } = await render('');
      expect(slides).toHaveLength(1);
      expect(textsOf(slides[0])).toEqual(['旅行の計画']);
    });

    it('段落の中のふつうの改行は空白にし、項目を別の段落に分けない', async () => {
      const { slides } = await render('## A\n\n- 一行目\n  続き\n- 次');
      expect(textsOf(slides[0])).toEqual(['A', '一行目 続き', '次']);
    });

    it('段落の中の改行は、段落の中の改行（<a:br/>）にする', async () => {
      const { slides } = await render('## A\n\n- 一行目  \n  二行目');
      expect(slides[0]).toContain('<a:br/>');
    });
  });

  describe('異常系', () => {
    it('危ない URL はハイパーリンクにしない', async () => {
      const { rels, slides } = await render(
        '## A\n\n[押す](javascript:alert(1))'
      );
      expect(rels[0]).not.toContain('javascript:');
      expect(textsOf(slides[0])).toContain('押す');
    });

    it('生の HTML は文字として入れる', async () => {
      const { slides } = await render('## A\n\n<script>alert(1)</script>');
      expect(textsOf(slides[0])).toContain(
        '&lt;script&gt;alert(1)&lt;/script&gt;'
      );
    });
  });
});
