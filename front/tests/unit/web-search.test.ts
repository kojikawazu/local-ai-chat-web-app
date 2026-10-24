import { describe, it, expect } from 'vitest';
import { formatSearchResponse } from '@/lib/agent/tools/web-search';

/**
 * `formatSearchResponse` の UT。SearXNG の応答本文を受け取る純関数のため mock は使わない。
 * 契約: 検索結果を一覧にし、0 件と失敗（検索エンジンが応答しない・応答の形が違う）を区別する（#151）。
 * 見出しの要約は件数で、0 件は `isEmpty`、失敗は `isError` と理由にする（#150）。
 * 失敗はクエリに関係なく起きるため、接続先ごと使えない印（`unavailable`）を付ける（#157）。
 */

/**
 * 結果の文章だけを取り出す（一覧の整形を検証するケース用）。
 *
 * @param body - SearXNG の応答本文
 * @returns モデルへ返す文章
 */
const textOf = (body: string) => formatSearchResponse('php 2025', body).result;

/**
 * SearXNG の `format=json` の応答本文を作る（実際の応答から、ツールが読むフィールドだけを写したもの）。
 *
 * @param results - `results` の要素
 * @param unresponsive - `unresponsive_engines`（`[エンジン名, 理由]` の配列）
 * @returns JSON 文字列
 */
function searxngBody(
  results: unknown[],
  unresponsive: [string, string][] = []
): string {
  return JSON.stringify({
    query: 'php 2025',
    number_of_results: 0,
    results,
    unresponsive_engines: unresponsive,
  });
}

/**
 * 検索結果 1 件を作る。
 *
 * @param n - タイトル・URL に入れる番号
 * @returns `results` の要素
 */
const resultOf = (n: number) => ({
  title: `PHP News ${n}`,
  url: `https://www.php.net/news/${n}`,
  content: `PHP の概要 ${n}`,
  engine: 'google cse',
});

describe('formatSearchResponse', () => {
  describe('正常系', () => {
    it('検索結果をタイトル・URL・概要の一覧にする', () => {
      const output = formatSearchResponse(
        'php 2025',
        searxngBody([resultOf(1), resultOf(2)])
      );

      expect(output).toMatchObject({ isError: false, summary: '2 件' });
      expect(output.isEmpty).toBeUndefined();
      expect(output.unavailable).toBeUndefined();
      expect(output.result).toBe(
        [
          '"php 2025" の検索結果 (上位2件):\n',
          '[1] PHP News 1',
          '    URL: https://www.php.net/news/1',
          '    PHP の概要 1',
          '',
          '[2] PHP News 2',
          '    URL: https://www.php.net/news/2',
          '    PHP の概要 2',
          '',
        ].join('\n')
      );
    });

    it('一部の検索エンジンが応答しなくても、結果があれば一覧にする', () => {
      const output = formatSearchResponse(
        'php 2025',
        searxngBody([resultOf(1)], [['duckduckgo', 'CAPTCHA']])
      );

      expect(output).toMatchObject({ isError: false, summary: '1 件' });
      expect(output.result).toMatch(/^"php 2025" の検索結果 \(上位1件\)/);
    });
  });

  describe('準正常系', () => {
    it('すべての検索エンジンが応答したうえでの 0 件は「見つかりませんでした」にし、空の結果として返す', () => {
      expect(formatSearchResponse('php 2025', searxngBody([]))).toEqual({
        result: '"php 2025" の検索結果が見つかりませんでした。',
        isError: false,
        summary: '0 件',
        isEmpty: true,
      });
    });

    it('0 件で応答しなかった検索エンジンがあれば、0 件ではなく失敗として名前を返し、検索し直さないよう伝える', () => {
      const output = formatSearchResponse(
        'php 2025',
        searxngBody(
          [],
          [
            ['brave', 'too many requests'],
            ['duckduckgo', 'CAPTCHA'],
          ]
        )
      );

      // 「時間をおいて検索し直して」と伝えると、モデルは待たずに言い換えて検索し続ける（#157）
      const reason =
        '"php 2025" の検索で、検索エンジンが応答しませんでした（brave, duckduckgo）。今は検索できないため、この応答の中で検索し直さず、検索できなかったことを伝えたうえで回答してください。';
      expect(output).toEqual({
        result: `エラー: ${reason}`,
        isError: true,
        summary: reason,
        unavailable: true,
      });
    });

    it('上位 5 件までに絞る', () => {
      const output = formatSearchResponse(
        'php 2025',
        searxngBody([1, 2, 3, 4, 5, 6, 7].map(resultOf))
      );
      const text = output.result;

      expect(output.summary).toBe('5 件');
      expect(text).toMatch(/上位5件/);
      expect(text).toContain('[5] PHP News 5');
      expect(text).not.toContain('PHP News 6');
    });

    it('概要が無い結果は URL の行で終える', () => {
      const text = textOf(
        searxngBody([{ title: 'PHP', url: 'https://www.php.net/' }])
      );

      expect(text).toContain('[1] PHP\n    URL: https://www.php.net/\n');
    });

    it('3,000 文字を超える結果は省略する', () => {
      const long = (n: number) => ({
        ...resultOf(n),
        content: 'あ'.repeat(800),
      });
      const text = textOf(searxngBody([1, 2, 3, 4, 5].map(long)));

      expect(text).toHaveLength(3000 + '…（省略）'.length);
      expect(text.endsWith('…（省略）')).toBe(true);
    });
  });

  describe('異常系', () => {
    it('JSON でない本文は解釈できないエラーにし、接続先ごと使えない印を付ける', () => {
      expect(formatSearchResponse('php 2025', '<html></html>')).toEqual({
        result:
          'エラー: SearXNG の応答を解釈できませんでした（JSON ではありません）',
        isError: true,
        summary: 'SearXNG の応答を解釈できませんでした（JSON ではありません）',
        unavailable: true,
      });
    });

    it.each([
      ['null', 'null'],
      ['配列', '[]'],
      ['results が配列でない', '{"results":"x"}'],
    ])('応答の形が違う（%s）ならエラーにする', (_label, body) => {
      expect(formatSearchResponse('php 2025', body)).toMatchObject({
        result:
          'エラー: SearXNG の応答を解釈できませんでした（results がありません）',
        isError: true,
        unavailable: true,
      });
    });

    it('タイトルが無い・URL が http / https でない要素は飛ばす', () => {
      const text = textOf(
        searxngBody([
          null,
          { url: 'https://example.com/' },
          { title: 'スクリプト', url: 'javascript:alert(1)' },
          { title: 123, url: 'https://example.com/' },
          resultOf(1),
        ])
      );

      expect(text).toMatch(/上位1件/);
      expect(text).not.toContain('javascript:');
      expect(text).toContain('[1] PHP News 1');
    });

    it('unresponsive_engines の形が違っても、0 件として扱う', () => {
      const body = JSON.stringify({
        results: [],
        unresponsive_engines: ['brave', [null], {}],
      });

      expect(formatSearchResponse('php 2025', body)).toMatchObject({
        result: '"php 2025" の検索結果が見つかりませんでした。',
        isError: false,
        isEmpty: true,
      });
    });
  });
});
