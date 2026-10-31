import { describe, it, expect } from 'vitest';
import { remapScreenshotIds, toForkTitle } from '@/lib/conversation/fork';
import { parseForkConversationBody } from '@/lib/server/request-body';
import { MAX_TITLE_LENGTH } from '@/lib/shared/validation';

/**
 * 会話の分岐（#29）の純ロジックの UT。外部 I/O が無いため mock は使わない。
 * 対象: 分岐した会話のタイトル（`toForkTitle`）・ツールの画面の ID の書き換え（`remapScreenshotIds`）・
 * ボディの検証（`parseForkConversationBody`）。
 */

const MESSAGE_ID = '11111111-1111-4111-8111-111111111111';

/**
 * ツールの画面を持つ応答の metadata を作る。
 *
 * @param ids - 1 つ目のツールの呼び出しが持つ画面の ID
 * @returns metadata
 */
const metadataWithShots = (ids: string[]) => ({
  thinking: '考えた',
  toolCalls: [
    {
      name: 'browser_navigate',
      result: '開いた',
      screenshots: ids.map((id) => ({
        id,
        kind: 'after',
        mimeType: 'image/jpeg',
        width: 640,
        height: 480,
      })),
    },
    { name: 'calculate', result: '2' },
  ],
});

describe('toForkTitle', () => {
  describe('正常系', () => {
    it('元のタイトルの後ろに（分岐）を付ける', () => {
      expect(toForkTitle('旅行の計画')).toBe('旅行の計画（分岐）');
    });

    it('もう（分岐）で終わっていれば重ねない', () => {
      expect(toForkTitle('旅行の計画（分岐）')).toBe('旅行の計画（分岐）');
    });

    it('前後の空白を除いてから付ける', () => {
      expect(toForkTitle('  旅行の計画 ')).toBe('旅行の計画（分岐）');
    });
  });

  describe('準正常系', () => {
    it('上限ちょうどのタイトルは、後ろを削って上限に収める', () => {
      const title = 'あ'.repeat(MAX_TITLE_LENGTH);
      const forked = toForkTitle(title);
      expect(forked).toHaveLength(MAX_TITLE_LENGTH);
      expect(forked.endsWith('（分岐）')).toBe(true);
    });

    it('サロゲートペアを割らずに削る', () => {
      // 絵文字は UTF-16 で 2 つ分。上限を超える分を文字単位で削る
      const title = '😀'.repeat(MAX_TITLE_LENGTH / 2);
      const forked = toForkTitle(title);
      expect(forked.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
      expect(forked.replace('（分岐）', '')).toMatch(/^(😀)+$/u);
    });

    it('空白だけのタイトルは既定のタイトルを元にする', () => {
      expect(toForkTitle('   ')).toBe('新しい会話（分岐）');
    });
  });

  describe('異常系', () => {
    it('空文字でも既定のタイトルを元にする（空のタイトルを作らない）', () => {
      expect(toForkTitle('')).toBe('新しい会話（分岐）');
    });
  });
});

describe('remapScreenshotIds', () => {
  describe('正常系', () => {
    it('対応のある画面の ID だけを書き換え、ほかの項目は残す', () => {
      const metadata = metadataWithShots(['a', 'b']);
      const remapped = remapScreenshotIds(
        metadata,
        new Map([
          ['a', 'A'],
          ['b', 'B'],
        ])
      );
      expect(remapped).toEqual({
        ...metadata,
        toolCalls: [
          {
            ...metadata.toolCalls[0],
            screenshots: [
              { ...metadata.toolCalls[0].screenshots?.[0], id: 'A' },
              { ...metadata.toolCalls[0].screenshots?.[1], id: 'B' },
            ],
          },
          metadata.toolCalls[1],
        ],
      });
    });

    it('元の metadata は書き換えない', () => {
      const metadata = metadataWithShots(['a']);
      const before = structuredClone(metadata);
      remapScreenshotIds(metadata, new Map([['a', 'A']]));
      expect(metadata).toEqual(before);
    });
  });

  describe('準正常系', () => {
    it('対応の無い ID は残す', () => {
      const remapped = remapScreenshotIds(
        metadataWithShots(['a', 'x']),
        new Map([['a', 'A']])
      ) as ReturnType<typeof metadataWithShots>;
      expect(remapped.toolCalls[0].screenshots?.map((shot) => shot.id)).toEqual(
        ['A', 'x']
      );
    });

    it('書き換える所が無ければ同じ値を返す', () => {
      const metadata = metadataWithShots(['x']);
      expect(remapScreenshotIds(metadata, new Map([['a', 'A']]))).toBe(
        metadata
      );
    });

    it('toolCalls の無い metadata・null はそのまま返す', () => {
      const thinkingOnly = { thinking: '考えた' };
      expect(remapScreenshotIds(thinkingOnly, new Map([['a', 'A']]))).toBe(
        thinkingOnly
      );
      expect(remapScreenshotIds(null, new Map([['a', 'A']]))).toBeNull();
    });
  });

  describe('異常系', () => {
    it('形の合わない要素（文字列・ID の無い画面・配列でない screenshots）はそのまま残す', () => {
      const metadata = {
        toolCalls: [
          'broken',
          { name: 'x', result: 'y', screenshots: 'broken' },
          { name: 'x', result: 'y', screenshots: [{ kind: 'after' }, 'a'] },
          { name: 'x', result: 'y', screenshots: [{ id: 'a' }] },
        ],
      };
      expect(remapScreenshotIds(metadata, new Map([['a', 'A']]))).toEqual({
        toolCalls: [
          'broken',
          { name: 'x', result: 'y', screenshots: 'broken' },
          { name: 'x', result: 'y', screenshots: [{ kind: 'after' }, 'a'] },
          { name: 'x', result: 'y', screenshots: [{ id: 'A' }] },
        ],
      });
    });

    it('配列の metadata・文字列はそのまま返す', () => {
      expect(remapScreenshotIds(['a'], new Map([['a', 'A']]))).toEqual(['a']);
      expect(remapScreenshotIds('a', new Map([['a', 'A']]))).toBe('a');
    });
  });
});

describe('parseForkConversationBody', () => {
  describe('正常系', () => {
    it('UUID の messageId を受け付ける', () => {
      expect(parseForkConversationBody({ messageId: MESSAGE_ID })).toEqual({
        ok: true,
        value: { messageId: MESSAGE_ID },
      });
    });
  });

  describe('準正常系', () => {
    it('UUID の形でない messageId は断る', () => {
      expect(parseForkConversationBody({ messageId: 'not-a-uuid' })).toEqual({
        ok: false,
        error: '無効なメッセージIDです',
      });
    });

    it('messageId が無ければ断る', () => {
      expect(parseForkConversationBody({})).toMatchObject({ ok: false });
    });
  });

  describe('異常系', () => {
    it('型違い・null・配列は断る', () => {
      expect(parseForkConversationBody({ messageId: 1 })).toMatchObject({
        ok: false,
      });
      expect(parseForkConversationBody(null)).toMatchObject({ ok: false });
      expect(parseForkConversationBody([MESSAGE_ID])).toMatchObject({
        ok: false,
      });
    });
  });
});
