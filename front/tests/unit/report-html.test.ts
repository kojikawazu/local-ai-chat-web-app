import { describe, it, expect } from 'vitest';
import type {
  RenderedDiagrams,
  ReportInput,
  ReportMessage,
} from '@/lib/chat/report-html';
import {
  buildReportHtml,
  collectDiagrams,
  diagramKey,
} from '@/lib/chat/report-html';
import { buildExportFileName } from '@/lib/chat/export';

/**
 * HTML のレポート（#36）の純ロジックの UT。外部 I/O が無いため mock は使わない。
 * 対象: 図の拾い出し（`collectDiagrams`）・レポートの組み立て（`buildReportHtml`。Markdown の変換・安全策・図と画像の埋め込み）。
 */

const NO_DIAGRAMS: RenderedDiagrams = new Map();
/** 埋め込める形の小さな PNG の data: URI（中身は検証しないため、Base64 の形だけ合わせる） */
const PNG_URI = 'data:image/png;base64,iVBORw0KGgo=';
const SVG_URI = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';

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

/**
 * 応答 1 件の Markdown だけを変換したレポートを返す。
 *
 * @param content - 応答の Markdown
 * @param diagrams - 描けた図
 * @returns レポートの HTML
 */
const answerHtml = (content: string, diagrams = NO_DIAGRAMS) =>
  buildReportHtml(input({ messages: [message({ content })] }), diagrams);

describe('collectDiagrams', () => {
  describe('正常系', () => {
    it('mermaid・plantuml（puml）のコードブロックを現れた順に拾う', () => {
      const markdown = [
        '```mermaid',
        'graph TD; A-->B',
        '```',
        '',
        '```puml',
        '@startuml',
        'A -> B',
        '@enduml',
        '```',
      ].join('\n');
      expect(collectDiagrams([markdown])).toEqual([
        { kind: 'mermaid', source: 'graph TD; A-->B' },
        { kind: 'plantuml', source: '@startuml\nA -> B\n@enduml' },
      ]);
    });
  });

  describe('準正常系', () => {
    it('同じ図は 1 つにまとめ、ほかの言語・空の図は拾わない', () => {
      const block = '```mermaid\ngraph TD; A-->B\n```';
      expect(
        collectDiagrams([
          block,
          block,
          '```ts\nconst a = 1;\n```',
          '```mermaid\n```',
        ])
      ).toEqual([{ kind: 'mermaid', source: 'graph TD; A-->B' }]);
    });
  });

  describe('異常系', () => {
    it('空の本文・図の無い本文では空', () => {
      expect(collectDiagrams([])).toEqual([]);
      expect(collectDiagrams(['', '# 見出しだけ'])).toEqual([]);
    });
  });
});

describe('buildReportHtml', () => {
  describe('正常系', () => {
    it('1 ファイルの HTML（doctype・文字コード・タイトル・CSS）を作り、スクリプトを入れない', () => {
      const html = buildReportHtml(input(), NO_DIAGRAMS);
      expect(html.startsWith('<!doctype html>')).toBe(true);
      expect(html).toContain('<meta charset="utf-8">');
      expect(html).toContain('<title>旅行の計画</title>');
      expect(html).toContain('<style>');
      expect(html).not.toMatch(/<script/i);
      expect(html).toContain('<h1>旅行の計画</h1>');
      expect(html).toContain('書き出した日時: 2026-10-31 22:00');
    });

    it('Markdown の見出し・表・リスト・コードの色付けを HTML にする', () => {
      const html = answerHtml(
        [
          '## 手順',
          '',
          '- 一つ目',
          '- 二つ目',
          '',
          '| 列 | 値 |',
          '|---|---|',
          '| a | 1 |',
          '',
          '```ts',
          'const answer = 42;',
          '```',
        ].join('\n')
      );
      expect(html).toContain('<h2>手順</h2>');
      expect(html).toContain('<li>一つ目</li>');
      expect(html).toContain('<table>');
      expect(html).toContain('<td>a</td>');
      expect(html).toContain('class="hljs language-ts"');
      expect(html).toContain('<span class="hljs-keyword">const</span>');
    });

    it('会話全体はメッセージを「ユーザー / アシスタント（日時）」の見出しで並べ、役割を出す', () => {
      const html = buildReportHtml(
        input({
          systemPrompt: 'あなたは旅行の案内係です。',
          messages: [
            message({ role: 'user', content: '京都は？\n二行目' }),
            message({ content: '**清水寺**です' }),
          ],
        }),
        NO_DIAGRAMS
      );
      expect(html).toContain('<h2>ユーザー（2026-10-31 21:05）</h2>');
      expect(html).toContain('<h2>アシスタント（2026-10-31 21:05）</h2>');
      // user は Markdown にせず、改行を保った文字のまま
      expect(html).toContain('<p class="plain">京都は？\n二行目</p>');
      expect(html).toContain('<strong>清水寺</strong>');
      expect(html).toContain('会話の役割: カスタム');
      expect(html).toContain('あなたは旅行の案内係です。');
    });

    it('描けた図はコードブロックの代わりに <img>（data: URI）で入れる', () => {
      const source = 'graph TD; A-->B';
      const html = answerHtml(
        `前\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\n後`,
        new Map([[diagramKey('mermaid', source), SVG_URI]])
      );
      expect(html).toContain(`<img src="${SVG_URI}" alt="mermaid の図">`);
      expect(html).not.toContain('language-mermaid');
    });

    it('添付画像を data: URI の <img> で本文の前に入れる', () => {
      const html = buildReportHtml(
        input({
          messages: [
            message({
              role: 'user',
              content: 'これは？',
              images: [{ dataUri: PNG_URI, width: 320, height: 200 }],
            }),
          ],
        }),
        NO_DIAGRAMS
      );
      expect(html).toContain(
        `<img src="${PNG_URI}" width="320" height="200" alt="添付画像">`
      );
      expect(html.indexOf(PNG_URI)).toBeLessThan(html.indexOf('これは？'));
    });
  });

  describe('準正常系', () => {
    it('描けなかった図はソースのコードブロックのまま残す', () => {
      const html = answerHtml('```mermaid\ngraph TD; A-->B\n```');
      expect(html).toContain('language-mermaid');
      // 本文の < と & だけがエスケープされる（> はそのまま。HTML として安全）
      expect(html).toContain('graph TD; A-->B');
    });

    it('読めなかった画像・形の合わない data: URI は注記にする', () => {
      const html = buildReportHtml(
        input({
          messages: [
            message({
              role: 'user',
              images: [
                null,
                {
                  dataUri: 'data:image/svg+xml;base64,PHN2Zz4=',
                  width: 1,
                  height: 1,
                },
              ],
            }),
          ],
        }),
        NO_DIAGRAMS
      );
      expect(html.match(/画像を読み込めませんでした/g)).toHaveLength(2);
      expect(html).not.toContain('image/svg+xml');
    });

    it('応答 1 件のときは役割を出さず、その応答だけを置く', () => {
      const html = buildReportHtml(
        input({ mode: 'message', systemPrompt: '役割の本文' }),
        NO_DIAGRAMS
      );
      expect(html).not.toContain('会話の役割');
      expect(html).not.toContain('役割の本文');
      expect(html.match(/<section/g)).toHaveLength(1);
    });

    it('中断した応答には注記を付ける', () => {
      expect(answerHtml('途中まで')).not.toContain('生成を中断した応答');
      const interrupted = buildReportHtml(
        input({ messages: [message({ interrupted: true })] }),
        NO_DIAGRAMS
      );
      expect(interrupted).toContain('（生成を中断した応答）');
    });

    it('ファイル名の拡張子を html にできる', () => {
      expect(
        buildExportFileName('旅行の計画', new Date(2026, 9, 31, 22, 0), 'html')
      ).toBe('旅行の計画_2026-10-31_2200.html');
    });
  });

  describe('異常系', () => {
    it('本文の生の HTML はタグにせず、文字として出す', () => {
      const html = answerHtml(
        '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">'
      );
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toMatch(/<img src="?x/);
      expect(html).toContain('&#x3C;script>alert(1)&#x3C;/script>');
    });

    it('危ない URL のリンクは外して文字だけにする', () => {
      const html = answerHtml(
        '[押す](javascript:alert(1)) と [公式](https://example.com)'
      );
      expect(html).not.toContain('javascript:');
      expect(html).toContain('<a>押す</a>');
      expect(html).toContain('<a href="https://example.com">公式</a>');
    });

    it('本文の画像は外部へ読みに行かせない（リンクにする・危ない URL は文字だけ）', () => {
      const html = answerHtml(
        '![猫](https://example.com/cat.png) ![悪い](javascript:alert(1))'
      );
      expect(html).not.toContain('<img src="https://example.com');
      expect(html).toContain(
        '<a href="https://example.com/cat.png">［画像: 猫］</a>'
      );
      expect(html).toContain('［画像: 悪い］');
      expect(html).not.toContain('javascript:');
    });

    it('タイトル・役割に書かれたタグはエスケープする', () => {
      const html = buildReportHtml(
        input({
          title: '<b>題</b>',
          systemPrompt: '</blockquote><script>x</script>',
        }),
        NO_DIAGRAMS
      );
      expect(html).toContain('<title>&#x3C;b>題&#x3C;/b></title>');
      expect(html).not.toMatch(/<script/i);
    });
  });
});
