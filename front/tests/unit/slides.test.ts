import { describe, it, expect } from 'vitest';
import type { SlideBlockKind } from '@/lib/chat/slides';
import { splitSlides, stripFrontMatter } from '@/lib/chat/slides';

/**
 * スライドの分け方（#36。`docs/26-html-slides-export.md`「スライドの分け方」）の UT。外部 I/O が無いため mock は使わない。
 *
 * `splitSlides` は総称の関数のため、ブロックを短い文字列（`#` は見出し、`---` は区切り線、`p` は段落、
 * 空文字は空白、ほかはそのほか）で表し、種類はこのテストの {@link kindOf} が決める。
 */

/**
 * テスト用の文字列のブロックを種類にする。
 *
 * @param block - `#`〜`######`（見出し）・`---`（区切り線）・`p…`（段落）・空文字（空白）・ほか（そのほか）
 * @returns ブロックの種類
 */
const kindOf = (block: string): SlideBlockKind => {
  if (block === '---') return { type: 'rule' };
  const heading = /^(#{1,6}) /.exec(block);
  if (heading) return { type: 'heading', depth: heading[1].length };
  if (block.startsWith('p')) return { type: 'paragraph' };
  if (block === '') return { type: 'blank' };
  return { type: 'other' };
};

/**
 * ブロックを分けて、スライドごとのブロックの並びだけを返す。
 *
 * @param blocks - ブロック
 * @returns スライドごとのブロック
 */
const split = (blocks: string[]): string[][] =>
  splitSlides(blocks, kindOf).map((slide) => slide.blocks);

describe('splitSlides', () => {
  describe('正常系', () => {
    it('区切り線があれば区切り線で分け、区切り線はスライドに入れない', () => {
      expect(split(['# 表紙', 'p 副題', '---', '## 背景', 'list'])).toEqual([
        ['# 表紙', 'p 副題'],
        ['## 背景', 'list'],
      ]);
    });

    it('区切り線があれば、見出しでは分けない', () => {
      expect(split(['## A', 'p', '## B', '---', '## C'])).toEqual([
        ['## A', 'p', '## B'],
        ['## C'],
      ]);
    });

    it('区切り線が無ければ、# と ## の前で分け、### はスライドの中に残す', () => {
      expect(
        split(['# 題', 'p', '## A', '### a1', 'list', '## B', 'code'])
      ).toEqual([
        ['# 題', 'p'],
        ['## A', '### a1', 'list'],
        ['## B', 'code'],
      ]);
    });

    it('## と ### だけなら ## の前で分ける', () => {
      expect(split(['## A', '### a1', '## B', '### b1'])).toEqual([
        ['## A', '### a1'],
        ['## B', '### b1'],
      ]);
    });

    it('### だけなら ### の前で分ける', () => {
      expect(split(['### A', 'p', '### B', 'p'])).toEqual([
        ['### A', 'p'],
        ['### B', 'p'],
      ]);
    });

    it('# だけでも 1 章 1 枚にする', () => {
      expect(split(['# A', 'p', '# B', 'p'])).toEqual([
        ['# A', 'p'],
        ['# B', 'p'],
      ]);
    });

    it('最初の見出しより前の本文は、それだけで 1 枚にする', () => {
      expect(split(['p 前置き', '## A', 'p'])).toEqual([
        ['p 前置き'],
        ['## A', 'p'],
      ]);
    });

    it('2 枚以上あり、1 枚目が見出しと段落だけなら表紙にする（2 枚目以降は表紙にしない）', () => {
      const slides = splitSlides(['# 題', '', 'p 副題', '## A', 'p'], kindOf);
      expect(slides.map((slide) => slide.cover)).toEqual([true, false]);
    });
  });

  describe('準正常系', () => {
    it('区切り線も見出しも無ければ 1 枚にし、表紙にしない', () => {
      const slides = splitSlides(['p 1', 'list', 'p 2'], kindOf);
      expect(slides).toEqual([
        { blocks: ['p 1', 'list', 'p 2'], cover: false },
      ]);
    });

    it('1 枚目にリストなどがあれば表紙にしない', () => {
      const slides = splitSlides(['# 題', 'list', '## A'], kindOf);
      expect(slides[0].cover).toBe(false);
    });

    it('1 枚目に見出しが無ければ（段落だけ）表紙にしない', () => {
      const slides = splitSlides(['p', '---', '## A'], kindOf);
      expect(slides[0].cover).toBe(false);
    });

    it('1 枚だけなら、見出しと段落だけでも表紙にしない', () => {
      expect(splitSlides(['# 題', 'p'], kindOf)[0].cover).toBe(false);
    });

    it('続く区切り線・先頭と末尾の区切り線・空白だけのスライドは捨てる', () => {
      expect(
        split(['---', '## A', '---', '', '---', '---', '## B', '', '---'])
      ).toEqual([['## A'], ['## B', '']]);
    });
  });

  describe('異常系', () => {
    it('ブロックが無い・空白だけなら空の配列', () => {
      expect(splitSlides([], kindOf)).toEqual([]);
      expect(splitSlides(['', ''], kindOf)).toEqual([]);
      expect(splitSlides(['---', '---'], kindOf)).toEqual([]);
    });
  });
});

describe('stripFrontMatter', () => {
  describe('正常系', () => {
    it('先頭の front matter（`key: value` の行）を取り除く', () => {
      expect(
        stripFrontMatter('---\nmarp: true\ntheme: default\n---\n# 題\n')
      ).toBe('# 題\n');
    });

    it('先頭の空行と、本文の終わりで閉じる front matter も取り除く', () => {
      expect(stripFrontMatter('\n---\nmarp: true\n---')).toBe('');
      expect(stripFrontMatter('---\r\nmarp: true\r\n---\r\n# 題')).toBe('# 題');
    });
  });

  describe('準正常系', () => {
    it('1 行目が `key:` の形でなければ front matter とみなさず、そのまま返す', () => {
      const markdown = '---\n## A\n---\n## B';
      expect(stripFrontMatter(markdown)).toBe(markdown);
    });

    it('先頭に無い `---` の囲みは取り除かない', () => {
      const markdown = '# 題\n---\nmarp: true\n---\n';
      expect(stripFrontMatter(markdown)).toBe(markdown);
    });
  });

  describe('異常系', () => {
    it('閉じの `---` が無ければそのまま返す', () => {
      const markdown = '---\nmarp: true\n# 題';
      expect(stripFrontMatter(markdown)).toBe(markdown);
    });
  });
});
