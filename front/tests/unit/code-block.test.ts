import { describe, it, expect } from 'vitest';
import { getCodeLanguage, hastToText } from '@/lib/code-block';
import type { HastNode } from '@/lib/code-block';

/**
 * `lib/code-block` の UT（#144）。
 * コードブロックの言語名ラベルとコピーする本文を、構文木（hast）から取り出す処理を確かめる。
 * 入力は react-markdown（mdast-util-to-hast）と rehype-highlight が作る形に合わせる。純関数のため mock は使わない。
 */

/**
 * テスト用のコードブロック（`pre > code`）を組み立てる。
 *
 * @param className - `code` 要素のクラス（省略時は付けない）
 * @param children - `code` 要素の子ノード
 * @returns `pre` 要素
 */
function codeBlock(
  className: unknown,
  children: HastNode[] = [{ type: 'text', value: 'x\n' }]
): HastNode {
  return {
    type: 'element',
    tagName: 'pre',
    properties: {},
    children: [
      {
        type: 'element',
        tagName: 'code',
        properties: className === undefined ? {} : { className },
        children,
      },
    ],
  };
}

describe('getCodeLanguage', () => {
  describe('正常系', () => {
    it('コードフェンスに書いた言語名を返す', () => {
      expect(getCodeLanguage(codeBlock(['language-typescript']))).toBe(
        'typescript'
      );
    });

    it('ハイライト後（先頭に hljs が付く）でも言語名を返す', () => {
      expect(getCodeLanguage(codeBlock(['hljs', 'language-ts']))).toBe('ts');
    });
  });

  describe('準正常系', () => {
    it('highlight.js に無い言語でも書かれたまま返す（ラベルは出す）', () => {
      expect(getCodeLanguage(codeBlock(['language-mermaid']))).toBe('mermaid');
    });

    it('言語の指定が無ければ null（ラベルを出さない）', () => {
      expect(getCodeLanguage(codeBlock(undefined))).toBeNull();
    });

    it('language- だけで名前が空なら null', () => {
      expect(getCodeLanguage(codeBlock(['language-']))).toBeNull();
    });
  });

  describe('異常系', () => {
    it('code 子要素が無ければ null', () => {
      expect(
        getCodeLanguage({ type: 'element', tagName: 'pre', children: [] })
      ).toBeNull();
    });

    it('className が配列でなければ null（想定外の形でも例外を投げない）', () => {
      expect(getCodeLanguage(codeBlock('language-ts'))).toBeNull();
    });

    it('className に文字列以外が混ざっていても読み飛ばす', () => {
      expect(getCodeLanguage(codeBlock([1, null, 'language-go']))).toBe('go');
    });
  });
});

describe('hastToText', () => {
  describe('正常系', () => {
    it('ハイライトで span に分かれた本文を元の文字列に戻す', () => {
      const pre = codeBlock(
        ['hljs', 'language-ts'],
        [
          {
            type: 'element',
            tagName: 'span',
            properties: { className: ['hljs-keyword'] },
            children: [{ type: 'text', value: 'const' }],
          },
          { type: 'text', value: ' a = ' },
          {
            type: 'element',
            tagName: 'span',
            properties: { className: ['hljs-number'] },
            children: [{ type: 'text', value: '1' }],
          },
          { type: 'text', value: ';\n' },
        ]
      );

      expect(hastToText(pre)).toBe('const a = 1;\n');
    });
  });

  describe('準正常系', () => {
    it('子の無い要素は空文字', () => {
      expect(hastToText({ type: 'element', tagName: 'code' })).toBe('');
    });
  });

  describe('異常系', () => {
    it('値の無いテキストノードは空文字として扱う', () => {
      expect(hastToText({ type: 'text' })).toBe('');
    });
  });
});
