import { describe, it, expect } from 'vitest';
import { isBotChallenge } from '@/lib/tools/web-search';

/**
 * `isBotChallenge` の UT。応答のステータスと本文だけを見る純関数のため mock は使わない。
 * 契約: DuckDuckGo のボット判定の確認ページを、検索結果（0 件を含む）と区別する（#151）。
 */

/** 検索結果のページ（結果のリンクと概要を持つ。実ページの構造を最小限に写したもの） */
const RESULTS_PAGE = `<html><body>
<div class="result results_links results_links_deep web-result">
  <a rel="nofollow" class="result__a" href="https://www.php.net/">PHP: Hypertext Preprocessor</a>
  <a class="result__snippet" href="https://www.php.net/">PHP is a popular general-purpose scripting language.</a>
</div>
</body></html>`;

/** 結果が 0 件のページ（結果のリンクも確認ページの目印も持たない） */
const NO_RESULTS_PAGE = `<html><body><div class="no-results">No results.</div></body></html>`;

/** 確認ページ（2026-10-23 に実際に返ったページの目印の部分だけを写したもの） */
const CHALLENGE_PAGE = `<html><body>
<form id="challenge-form" action="//duckduckgo.com/anomaly.js?sv=html&cc=sre" method="POST">
  <div class="anomaly-modal__box" id="anomaly-modal">
    <div class="anomaly-modal__check"></div>
  </div>
  <button name="challenge-submit">Submit</button>
</form>
</body></html>`;

describe('isBotChallenge', () => {
  describe('正常系', () => {
    it('HTTP 202 の確認ページを確認ページと判定する', () => {
      expect(isBotChallenge(202, CHALLENGE_PAGE)).toBe(true);
    });

    it('HTTP 200 の検索結果のページは確認ページではない', () => {
      expect(isBotChallenge(200, RESULTS_PAGE)).toBe(false);
    });
  });

  describe('準正常系', () => {
    it('結果が 0 件のページは確認ページではない（0 件と拒否を区別する）', () => {
      expect(isBotChallenge(200, NO_RESULTS_PAGE)).toBe(false);
    });

    it('HTTP 200 でも本文に確認ページの目印があれば確認ページと判定する', () => {
      expect(isBotChallenge(200, CHALLENGE_PAGE)).toBe(true);
    });

    it.each([
      ['確認用モーダル', '<div id="anomaly-modal"></div>'],
      ['画像選択フォーム', '<form id="challenge-form"></form>'],
      ['判定スクリプト', '<form action="//duckduckgo.com/anomaly.js?sv=html">'],
    ])('目印が %s だけでも確認ページと判定する', (_label, html) => {
      expect(isBotChallenge(200, html)).toBe(true);
    });
  });

  describe('異常系', () => {
    it('HTTP 202 なら本文が空でも確認ページと判定する', () => {
      expect(isBotChallenge(202, '')).toBe(true);
    });

    it('検索結果の本文に "anomaly" という語が含まれるだけでは確認ページとみなさない', () => {
      const html = RESULTS_PAGE.replace(
        'PHP is a popular',
        'Anomaly detection in PHP is a popular'
      );
      expect(isBotChallenge(200, html)).toBe(false);
    });
  });
});
