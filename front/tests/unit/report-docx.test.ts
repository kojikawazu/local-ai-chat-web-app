import { describe, it, expect } from 'vitest';
import * as docx from 'docx';
import JSZip from 'jszip';
import type { ReportDocument } from '@/lib/chat/document-model';
import { markdownToBlocks } from '@/lib/chat/document-model';
import { buildDocx } from '@/lib/chat/report-docx';

/** zip の中の、埋め込んだ画像のファイル（フォルダの項目 `word/media/` だけでは数えない） */
const MEDIA_FILE = /^word\/media\/[^/]+\.(?:png|jpe?g)$/;

/**
 * 書き出しの文書の中間の形 → DOCX（#36。`report-docx.ts`）の UT。
 *
 * node の `docx` で実際に DOCX を作り、`jszip` で中の `word/document.xml` を読んで、Word の書式になっていることを確かめる
 * （外部 I/O は無い。docx は差し替えずに本物を使う）。
 */

/** 1×1 の PNG のバイト列 */
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  ),
  (c) => c.charCodeAt(0)
);

/**
 * 文書を作り、DOCX にして中のファイルを読む。
 *
 * @param doc - 書き出しの文書
 * @returns `word/document.xml` の中身と、zip の中のファイル名の一覧
 */
async function render(doc: ReportDocument) {
  const buffer = await docx.Packer.toBuffer(buildDocx(docx, doc));
  const zip = await JSZip.loadAsync(buffer);
  const documentXml =
    (await zip.file('word/document.xml')?.async('string')) ?? '';
  return { documentXml, files: Object.keys(zip.files) };
}

/**
 * 1 つのメッセージだけの文書を作る。
 *
 * @param markdown - 応答の Markdown
 * @returns 書き出しの文書
 */
const docOf = (markdown: string): ReportDocument => ({
  title: '旅行の計画',
  meta: ['書き出した日時: 2026-10-31 22:00'],
  role: null,
  sections: [
    {
      heading: 'アシスタント（2026-10-31 21:05）',
      blocks: markdownToBlocks(markdown, new Map()),
    },
  ],
});

/**
 * 段落の見出しのスタイル名を、現れた順に取り出す。
 *
 * @param xml - `word/document.xml`
 * @returns スタイル名（`Title`・`Heading1` 等）
 */
const styles = (xml: string) =>
  [...xml.matchAll(/<w:pStyle w:val="([^"]+)"\/>/g)].map((m) => m[1]);

describe('buildDocx', () => {
  describe('正常系', () => {
    it('表題・メッセージの見出し 1・本文の見出しを 1 段下げたスタイルにする', async () => {
      const { documentXml } = await render(
        docOf('# 大\n\n## 中\n\n### 小\n\n#### さらに小')
      );
      expect(documentXml).toContain('旅行の計画');
      expect(documentXml).toContain('アシスタント（2026-10-31 21:05）');
      expect(styles(documentXml).filter((s) => s !== 'ListParagraph')).toEqual([
        'Title',
        'Heading1',
        'Heading2',
        'Heading3',
        'Heading4',
        'Heading4',
      ]);
    });

    it('表・ハイパーリンク・コードのフォントを入れる', async () => {
      const { documentXml } = await render(
        docOf(
          '| 列 | 値 |\n|---|---|\n| a | 1 |\n\n[公式](https://example.com)\n\n```ts\nconst a = 1;\n```'
        )
      );
      expect(documentXml).toContain('<w:tbl>');
      expect(documentXml).toContain('<w:tblHeader');
      expect(documentXml).toContain('<w:hyperlink');
      expect(documentXml).toContain('Consolas');
      expect(documentXml).toContain('const a = 1;');
    });

    it('画像をメディアとして埋め込む', async () => {
      const { documentXml, files } = await render({
        ...docOf(''),
        sections: [
          {
            heading: 'ユーザー',
            blocks: [
              {
                type: 'image',
                image: {
                  data: PNG,
                  mimeType: 'image/png',
                  width: 1,
                  height: 1,
                  alt: '添付画像',
                },
              },
            ],
          },
        ],
      });
      expect(files.some((name) => MEDIA_FILE.test(name))).toBe(true);
      expect(documentXml).toContain('<w:drawing>');
    });
  });

  describe('準正常系', () => {
    it('番号付きリストはリストごとに数え直す（別の番号の組にする）', async () => {
      const { documentXml } = await render(docOf('1. a\n2. b\n\n段落\n\n1. c'));
      const numIds = [
        ...documentXml.matchAll(/<w:numId w:val="(\d+)"\/>/g),
      ].map((m) => m[1]);
      expect(numIds).toHaveLength(3);
      expect(numIds[0]).toBe(numIds[1]);
      expect(numIds[2]).not.toBe(numIds[0]);
    });

    it('注記は斜体の段落にする', async () => {
      const { documentXml } = await render({
        ...docOf(''),
        sections: [
          {
            heading: 'ユーザー',
            blocks: [{ type: 'note', text: '（画像を読み込めませんでした）' }],
          },
        ],
      });
      expect(documentXml).toContain('（画像を読み込めませんでした）');
      expect(documentXml).toContain('<w:i/>');
    });
  });

  describe('異常系', () => {
    it('本文の生の HTML・特殊な文字は XML としてエスケープされる', async () => {
      const { documentXml } = await render(
        docOf('<script>alert("x")</script> & 1 < 2')
      );
      expect(documentXml).not.toContain('<script>');
      expect(documentXml).toContain('&lt;script&gt;');
      expect(documentXml).toContain('&amp; 1 &lt; 2');
    });
  });
});
