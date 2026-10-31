import { describe, it, expect } from 'vitest';
import type { DiagramImages, DocImage } from '@/lib/chat/document-model';
import {
  buildReportDocument,
  markdownToBlocks,
  toDocImage,
} from '@/lib/chat/document-model';
import { diagramKey } from '@/lib/chat/report-html';
import type { ReportInput, ReportMessage } from '@/lib/chat/report-html';

/**
 * 書き出しの文書の中間の形（#36。DOCX・後のスライドで使う）の UT。外部 I/O が無いため mock は使わない。
 * 対象: Markdown → ブロック（`markdownToBlocks`）・文書の全体（`buildReportDocument`）・添付画像の変換（`toDocImage`）。
 */

const NO_DIAGRAMS: DiagramImages = new Map();
/** 1×1 の PNG の data: URI */
const PNG_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** 描けた図の画像（中身は確かめないため、小さなバイト列にする） */
const DIAGRAM_IMAGE: DocImage = {
  data: new Uint8Array([1, 2, 3]),
  mimeType: 'image/png',
  width: 300,
  height: 200,
  alt: '図',
};

/**
 * メッセージを作る。
 *
 * @param overrides - 変える項目
 * @returns メッセージ
 */
const message = (overrides: Partial<ReportMessage> = {}): ReportMessage => ({
  role: 'assistant',
  content: '本文',
  createdAt: new Date(2026, 9, 31, 21, 5),
  interrupted: false,
  images: [],
  ...overrides,
});

/**
 * レポートの中身を作る（会話全体・役割なし）。
 *
 * @param overrides - 変える項目
 * @returns レポートの中身
 */
const input = (overrides: Partial<ReportInput> = {}): ReportInput => ({
  mode: 'conversation',
  title: '旅行の計画',
  exportedAt: new Date(2026, 9, 31, 22, 0),
  systemPrompt: null,
  messages: [message()],
  ...overrides,
});

describe('markdownToBlocks', () => {
  describe('正常系', () => {
    it('見出しは Markdown の段階のまま、段落の強調・斜体・取り消し線・コード・改行を片にする', () => {
      expect(
        markdownToBlocks(
          '### 手順\n\n**太字**と*斜体*と~~消す~~と`code`\\\n次の行',
          NO_DIAGRAMS
        )
      ).toEqual([
        { type: 'heading', depth: 3, runs: [{ type: 'text', text: '手順' }] },
        {
          type: 'paragraph',
          runs: [
            { type: 'text', text: '太字', bold: true },
            { type: 'text', text: 'と' },
            { type: 'text', text: '斜体', italic: true },
            { type: 'text', text: 'と' },
            { type: 'text', text: '消す', strike: true },
            { type: 'text', text: 'と' },
            { type: 'text', text: 'code', code: true },
            { type: 'break' },
            { type: 'text', text: '次の行' },
          ],
        },
      ]);
    });

    it('リスト（番号・入れ子・タスク）を項目のブロックにする', () => {
      const [list] = markdownToBlocks(
        '1. 一つ目\n   - 入れ子\n2. 二つ目\n\n- [x] 済み\n- [ ] まだ',
        NO_DIAGRAMS
      );
      expect(list).toMatchObject({
        type: 'list',
        ordered: true,
        items: [
          {
            checked: null,
            blocks: [
              { type: 'paragraph', runs: [{ type: 'text', text: '一つ目' }] },
              { type: 'list', ordered: false },
            ],
          },
          { checked: null },
        ],
      });
      const tasks = markdownToBlocks('- [x] 済み\n- [ ] まだ', NO_DIAGRAMS)[0];
      expect(tasks).toMatchObject({
        type: 'list',
        items: [{ checked: true }, { checked: false }],
      });
    });

    it('表は列の揃えと、見出しの行から順の行・セルにする', () => {
      expect(
        markdownToBlocks('| 列 | 値 |\n|:--|--:|\n| a | 1 |', NO_DIAGRAMS)
      ).toEqual([
        {
          type: 'table',
          align: ['left', 'right'],
          rows: [
            [[{ type: 'text', text: '列' }], [{ type: 'text', text: '値' }]],
            [[{ type: 'text', text: 'a' }], [{ type: 'text', text: '1' }]],
          ],
        },
      ]);
    });

    it('コード・引用・区切り線・安全なリンクをブロックにする', () => {
      expect(
        markdownToBlocks(
          '```ts\nconst a = 1;\n```\n\n> 引用\n\n---\n\n[公式](https://example.com)',
          NO_DIAGRAMS
        )
      ).toEqual([
        { type: 'code', language: 'ts', text: 'const a = 1;' },
        {
          type: 'quote',
          blocks: [
            { type: 'paragraph', runs: [{ type: 'text', text: '引用' }] },
          ],
        },
        { type: 'rule' },
        {
          type: 'paragraph',
          runs: [{ type: 'text', text: '公式', link: 'https://example.com' }],
        },
      ]);
    });

    it('描けた図は画像のブロックにする', () => {
      const source = 'graph TD; A-->B';
      expect(
        markdownToBlocks(
          `\`\`\`mermaid\n${source}\n\`\`\``,
          new Map([[diagramKey('mermaid', source), DIAGRAM_IMAGE]])
        )
      ).toEqual([{ type: 'image', image: DIAGRAM_IMAGE }]);
    });
  });

  describe('準正常系', () => {
    it('描けなかった図はコードブロックのまま', () => {
      expect(
        markdownToBlocks('```plantuml\n@startuml\n@enduml\n```', NO_DIAGRAMS)
      ).toEqual([
        { type: 'code', language: 'plantuml', text: '@startuml\n@enduml' },
      ]);
    });

    it('本文の画像は埋め込まず、安全な URL はリンク・危ない URL は文字だけにする', () => {
      expect(
        markdownToBlocks(
          '![猫](https://example.com/cat.png) ![悪い](javascript:alert(1))',
          NO_DIAGRAMS
        )
      ).toEqual([
        {
          type: 'paragraph',
          runs: [
            {
              type: 'text',
              text: '［画像: 猫］',
              link: 'https://example.com/cat.png',
            },
            { type: 'text', text: ' ' },
            { type: 'text', text: '［画像: 悪い］' },
          ],
        },
      ]);
    });

    it('空の本文は空のブロック', () => {
      expect(markdownToBlocks('', NO_DIAGRAMS)).toEqual([]);
    });
  });

  describe('異常系', () => {
    it('生の HTML はタグにせず文字にする', () => {
      expect(
        markdownToBlocks('<script>alert(1)</script>', NO_DIAGRAMS)
      ).toEqual([
        {
          type: 'paragraph',
          runs: [{ type: 'text', text: '<script>alert(1)</script>' }],
        },
      ]);
    });

    it('危ない URL のリンクは文字だけにする', () => {
      expect(
        markdownToBlocks('[押す](javascript:alert(1))', NO_DIAGRAMS)
      ).toEqual([
        { type: 'paragraph', runs: [{ type: 'text', text: '押す' }] },
      ]);
    });
  });
});

describe('buildReportDocument・toDocImage', () => {
  describe('正常系', () => {
    it('会話全体はタイトル・情報・役割と、メッセージごとの見出しと本文にする', () => {
      const doc = buildReportDocument(
        input({
          systemPrompt: 'あなたは旅行の案内係です。',
          messages: [
            message({ role: 'user', content: '京都は？\n二行目' }),
            message({ content: '## 答え' }),
          ],
        }),
        NO_DIAGRAMS
      );
      expect(doc.title).toBe('旅行の計画');
      expect(doc.meta).toEqual([
        '書き出した日時: 2026-10-31 22:00',
        '会話の役割: カスタム',
      ]);
      expect(doc.role).toBe('あなたは旅行の案内係です。');
      expect(doc.sections.map((section) => section.heading)).toEqual([
        'ユーザー（2026-10-31 21:05）',
        'アシスタント（2026-10-31 21:05）',
      ]);
      // user は Markdown にせず、改行を保つ
      expect(doc.sections[0].blocks).toEqual([
        {
          type: 'paragraph',
          runs: [
            { type: 'text', text: '京都は？' },
            { type: 'break' },
            { type: 'text', text: '二行目' },
          ],
        },
      ]);
      expect(doc.sections[1].blocks[0]).toMatchObject({
        type: 'heading',
        depth: 2,
      });
    });

    it('添付画像はバイト列の画像にして本文の前に置く', () => {
      const image = toDocImage({ dataUri: PNG_URI, width: 1, height: 1 });
      expect(image).toMatchObject({ mimeType: 'image/png', width: 1 });
      expect(Array.from(image?.data.slice(0, 4) ?? [])).toEqual([
        0x89, 0x50, 0x4e, 0x47,
      ]);
      const doc = buildReportDocument(
        input({
          messages: [
            message({
              role: 'user',
              content: 'これは？',
              images: [{ dataUri: PNG_URI, width: 1, height: 1 }],
            }),
          ],
        }),
        NO_DIAGRAMS
      );
      expect(doc.sections[0].blocks.map((block) => block.type)).toEqual([
        'image',
        'paragraph',
      ]);
    });
  });

  describe('準正常系', () => {
    it('応答 1 件のときは役割を出さない。中断した応答には注記を付ける', () => {
      const doc = buildReportDocument(
        input({
          mode: 'message',
          systemPrompt: '役割の本文',
          messages: [message({ interrupted: true })],
        }),
        NO_DIAGRAMS
      );
      expect(doc.role).toBeNull();
      expect(doc.meta).toHaveLength(1);
      expect(doc.sections[0].blocks.at(-1)).toEqual({
        type: 'note',
        text: '（生成を中断した応答）',
      });
    });
  });

  describe('異常系', () => {
    it('読めなかった画像・形の合わない data: URI は注記にする', () => {
      expect(
        toDocImage({
          dataUri: 'data:image/svg+xml;base64,PHN2Zz4=',
          width: 1,
          height: 1,
        })
      ).toBeNull();
      const doc = buildReportDocument(
        input({ messages: [message({ role: 'user', images: [null] })] }),
        NO_DIAGRAMS
      );
      expect(doc.sections[0].blocks[0]).toEqual({
        type: 'note',
        text: '（画像を読み込めませんでした）',
      });
    });
  });
});
