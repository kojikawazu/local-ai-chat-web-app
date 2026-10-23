import { describe, it, expect } from 'vitest';
import { buildCurrentDateNotice, withCurrentDate } from '@/lib/current-date';

/**
 * システムプロンプトに付ける「現在の日時」の UT（#154）。
 * 日時とタイムゾーンを引数で受け取る純関数のため mock は使わない。
 * 契約: 日付・曜日・時刻・タイムゾーンを知らせ、モードごとに「最新」の扱いを指示する。
 */

// 日本時間では 10 月 24 日（土）0 時 5 分、UTC では 23 日（金）。日付の境目でタイムゾーンが効くことを見る
const NOW = new Date('2026-10-23T15:05:00Z');

describe('buildCurrentDateNotice', () => {
  describe('正常系', () => {
    it('エージェントモードでは、日時と「検索語にこの年を使う」指示を返す', () => {
      expect(
        buildCurrentDateNotice({
          now: NOW,
          timeZone: 'Asia/Tokyo',
          enableTools: true,
        })
      ).toBe(
        [
          '## 現在の日時',
          '2026年10月24日（土）00:05（Asia/Tokyo、UTC+09:00）',
          '',
          '- 「最新」「今年」「現在」「最近」などは、この日時を基準に解釈すること',
          '- あなたの知識はこの日時より古い可能性がある',
          '- 検索語に年を入れる場合は、この日時の年を使うこと',
          '- 知識と検索結果が食い違う場合は、日付の新しい検索結果を優先すること',
        ].join('\n')
      );
    });

    it('通常モードでは、検索できないことと、知識の時点を断定しない指示を返す', () => {
      const notice = buildCurrentDateNotice({
        now: NOW,
        timeZone: 'Asia/Tokyo',
        enableTools: false,
      });

      expect(notice).toContain(
        '2026年10月24日（土）00:05（Asia/Tokyo、UTC+09:00）'
      );
      expect(notice).toContain(
        '- この会話では Web 検索ができない。最新の情報を聞かれたら、この日時の時点の情報として断定しないこと。「学習した時点の知識では」と前置きし、それより新しいものが出ている可能性を添えること'
      );
      expect(notice).not.toContain('検索語に年を入れる');
    });
  });

  describe('準正常系', () => {
    it.each([
      ['UTC', '2026年10月23日（金）15:05（UTC、UTC+00:00）'],
      [
        'America/New_York',
        '2026年10月23日（金）11:05（America/New_York、UTC-04:00）',
      ],
      ['Asia/Kolkata', '2026年10月23日（金）20:35（Asia/Kolkata、UTC+05:30）'],
    ])(
      'タイムゾーン %s では、その地域の日付・時刻と UTC との差を返す',
      (timeZone, expected) => {
        expect(
          buildCurrentDateNotice({ now: NOW, timeZone, enableTools: true })
        ).toContain(`\n${expected}\n`);
      }
    );
  });

  describe('異常系', () => {
    it.each([['Mars/Olympus'], ['']])(
      '不正なタイムゾーン「%s」は例外にせず UTC で表示する',
      (timeZone) => {
        expect(
          buildCurrentDateNotice({ now: NOW, timeZone, enableTools: true })
        ).toContain('\n2026年10月23日（金）15:05（UTC、UTC+00:00）\n');
      }
    );
  });
});

describe('withCurrentDate', () => {
  const options = { now: NOW, timeZone: 'Asia/Tokyo', enableTools: true };
  const notice = buildCurrentDateNotice(options);

  describe('正常系', () => {
    it('システムプロンプトの後ろに、空行を挟んで日時の節を足す', () => {
      expect(withCurrentDate('あなたは翻訳者です。', options)).toBe(
        `あなたは翻訳者です。\n\n${notice}`
      );
    });
  });

  describe('準正常系', () => {
    it('システムプロンプトの前後の空白は除く', () => {
      expect(withCurrentDate('  あなたは翻訳者です。\n', options)).toBe(
        `あなたは翻訳者です。\n\n${notice}`
      );
    });
  });

  describe('異常系', () => {
    it.each([
      ['未指定', undefined],
      ['空文字', ''],
      ['空白のみ', ' \n '],
    ])(
      'システムプロンプトが%sでも、日時の節だけは返す',
      (_label, systemPrompt) => {
        expect(withCurrentDate(systemPrompt, options)).toBe(notice);
      }
    );
  });
});
