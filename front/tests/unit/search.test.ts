import { describe, it, expect } from 'vitest';
import {
  buildSnippet,
  escapeLikePattern,
  parseSearchQuery,
  parseSearchTerms,
  splitHighlights,
} from '@/lib/search';
import { MAX_SEARCH_QUERY_LENGTH, MAX_SEARCH_TERMS } from '@/lib/validation';

/**
 * 会話検索（`lib/search.ts`。#11）の UT。文字列を受け取る純関数のため mock は使わない。
 * 契約: キーワードは空白で区切って AND で探し、抜粋は最初の一致箇所の前後を切り出し、
 * 強調は一致した片とそれ以外に分ける。LIKE の記号（`%`・`_`）は文字として扱う。
 */

/**
 * クエリパラメータを組み立てて検証する。
 *
 * @param params - クエリパラメータ
 * @returns 検証の結果
 */
const parse = (params: Record<string, string>) =>
  parseSearchQuery(new URLSearchParams(params));

/**
 * 強調の片を `[一致]` の記法で 1 本の文字列にする（期待値を読みやすくするため）。
 *
 * @param text - 対象の文字列
 * @param terms - キーワード
 * @returns 一致した片を角括弧で囲んで連結した文字列
 */
const marked = (text: string, terms: string[]) =>
  splitHighlights(text, terms)
    .map((p) => (p.match ? `[${p.text}]` : p.text))
    .join('');

describe('会話検索', () => {
  describe('正常系', () => {
    it('キーワードを空白（全角の空白を含む）で区切る', () => {
      expect(parseSearchTerms('React　フック  useState')).toEqual([
        'React',
        'フック',
        'useState',
      ]);
    });

    it('クエリを検証し、キーワードと開始位置を返す', () => {
      expect(parse({ q: ' Java 最新 ', offset: '20' })).toEqual({
        ok: true,
        value: { terms: ['Java', '最新'], offset: 20 },
      });
    });

    it('offset を省略したら 0 から返す', () => {
      expect(parse({ q: 'Java' })).toEqual({
        ok: true,
        value: { terms: ['Java'], offset: 0 },
      });
    });

    it('本文の中ほどの一致は、前後 40 文字を残して両側に … を付ける', () => {
      const text = `${'あ'.repeat(100)}キーワード${'い'.repeat(100)}`;

      expect(buildSnippet(text, ['キーワード'])).toBe(
        `…${'あ'.repeat(40)}キーワード${'い'.repeat(40)}…`
      );
    });

    it('一致した片とそれ以外に分け、大文字・小文字を区別しない', () => {
      expect(marked('Java と JAVA と java', ['java'])).toBe(
        '[Java] と [JAVA] と [java]'
      );
    });

    it('複数のキーワードをそれぞれ強調する', () => {
      expect(marked('React のフックの使い方', ['フック', 'react'])).toBe(
        '[React] の[フック]の使い方'
      );
    });
  });

  describe('準正常系', () => {
    it('大文字・小文字だけが違う重複は 1 つにまとめる', () => {
      expect(parseSearchTerms('Java java JAVA')).toEqual(['Java']);
    });

    it('先頭・末尾付近の一致は、切っていない側に … を付けない', () => {
      expect(buildSnippet('Java の最新は 25', ['java'])).toBe(
        'Java の最新は 25'
      );
      // 一致は 63 文字目。前の 40 文字は「あ」37 文字と「末尾 」
      expect(buildSnippet(`${'あ'.repeat(60)}末尾 Java`, ['java'])).toBe(
        `…${'あ'.repeat(37)}末尾 Java`
      );
    });

    it('抜粋の改行・連続する空白は 1 つの空白にまとめる', () => {
      expect(buildSnippet('1 行目\n\n  Java\t3 行目', ['java'])).toBe(
        '1 行目 Java 3 行目'
      );
    });

    it('複数のキーワードは、本文で先に現れた方を中心に切り出す', () => {
      const text = `${'あ'.repeat(50)}React${'い'.repeat(100)}フック`;

      expect(buildSnippet(text, ['フック', 'React'])).toBe(
        `…${'あ'.repeat(40)}React${'い'.repeat(40)}…`
      );
    });

    it('重なるキーワードは長い方で強調する', () => {
      expect(marked('React Hooks の解説', ['React', 'React Hooks'])).toBe(
        '[React Hooks] の解説'
      );
    });

    it('正規表現・LIKE の記号を含むキーワードも文字として扱う', () => {
      expect(marked('C++ と C# と 100% と a_b', ['c++', '100%', 'a_b'])).toBe(
        '[C++] と C# と [100%] と [a_b]'
      );
      expect(escapeLikePattern('100%_a\\b')).toBe('100\\%\\_a\\\\b');
    });

    it('絵文字（サロゲートペア）の途中で抜粋を切らない', () => {
      const snippet = buildSnippet(`${'😀'.repeat(30)}キーワード`, [
        'キーワード',
      ]);

      // 文字化けの元になる、対になっていないサロゲートが残らない
      expect(snippet).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
      expect(snippet).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    });
  });

  describe('異常系', () => {
    it.each([
      ['q が無い', {}],
      ['空白だけ', { q: ' 　 ' }],
    ])('キーワードが無ければエラーにする（%s）', (_label, params) => {
      expect(parse(params)).toEqual({
        ok: false,
        error: 'キーワードを入力してください',
      });
    });

    it('上限を超える長さのキーワードはエラーにする', () => {
      expect(parse({ q: 'あ'.repeat(MAX_SEARCH_QUERY_LENGTH) }).ok).toBe(true);
      expect(parse({ q: 'あ'.repeat(MAX_SEARCH_QUERY_LENGTH + 1) })).toEqual({
        ok: false,
        error: `キーワードは ${MAX_SEARCH_QUERY_LENGTH} 文字以内で入力してください`,
      });
    });

    it('上限を超える数の語はエラーにする', () => {
      const words = (n: number) =>
        Array.from({ length: n }, (_, i) => `語${i}`).join(' ');

      expect(parse({ q: words(MAX_SEARCH_TERMS) }).ok).toBe(true);
      expect(parse({ q: words(MAX_SEARCH_TERMS + 1) })).toEqual({
        ok: false,
        error: `キーワードは ${MAX_SEARCH_TERMS} 語までにしてください`,
      });
    });

    it.each(['-1', '1.5', 'abc', '', ' 1', '1e3', '0x10'])(
      '0 以上の整数でない offset（%j）はエラーにする',
      (offset) => {
        expect(parse({ q: 'Java', offset })).toEqual({
          ok: false,
          error: 'offset は 0 以上の整数で指定してください',
        });
      }
    );

    it('キーワードが現れない本文の抜粋は null にする', () => {
      expect(buildSnippet('関係のない本文', ['Java'])).toBeNull();
      expect(buildSnippet('本文', [])).toBeNull();
    });

    it('キーワードが無ければ強調せず、空文字は空の配列にする', () => {
      expect(splitHighlights('Java', [])).toEqual([
        { text: 'Java', match: false },
      ]);
      expect(splitHighlights('', ['Java'])).toEqual([]);
    });
  });
});
