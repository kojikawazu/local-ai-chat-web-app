import { describe, it, expect } from 'vitest';
import {
  selectChatImages,
  withOmittedImagesNote,
} from '@/lib/server/chat-images';
import { MAX_IMAGES_PER_REQUEST } from '@/lib/shared/validation';

/**
 * `lib/server/chat-images` の UT（#6）。
 * `/api/chat` で LLM へ渡す画像の選び方（新しい順・合計の上限・メッセージ単位・非対応モデル）と、
 * 渡さなかった画像の注記を確かめる。純関数のため mock は使わない。
 */

/**
 * テスト用の添付 ID を作る。
 *
 * @param prefix - ID の接頭辞（どのメッセージの画像かを読みやすくする）
 * @param count - 枚数
 * @returns `prefix-0`・`prefix-1`… の配列
 */
function ids(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
}

describe('selectChatImages', () => {
  describe('正常系', () => {
    it('上限に収まるなら、すべてのメッセージの画像を渡す', () => {
      const result = selectChatImages([ids('a', 2), [], ids('c', 1)], {
        supportsVision: true,
      });
      expect(result.map((s) => s.includedIds)).toEqual([
        ['a-0', 'a-1'],
        [],
        ['c-0'],
      ]);
      expect(result.every((s) => s.omittedCount === 0)).toBe(true);
    });

    it('上限を超える分は古いメッセージから渡さない', () => {
      const result = selectChatImages(
        [ids('old', 2), ids('mid', 2), ids('new', 2)],
        { supportsVision: true, maxImages: 4 }
      );
      expect(result.map((s) => s.includedIds)).toEqual([
        [],
        ['mid-0', 'mid-1'],
        ['new-0', 'new-1'],
      ]);
      expect(result[0]).toMatchObject({ omittedCount: 2, omitReason: 'old' });
    });
  });

  describe('準正常系', () => {
    it('既定の上限は MAX_IMAGES_PER_REQUEST 枚（境界値）', () => {
      const messages = Array.from(
        { length: MAX_IMAGES_PER_REQUEST + 1 },
        (_, i) => ids(`m${i}`, 1)
      );
      const result = selectChatImages(messages, { supportsVision: true });
      const included = result.flatMap((s) => s.includedIds);
      expect(included).toHaveLength(MAX_IMAGES_PER_REQUEST);
      expect(result[0].omittedCount).toBe(1);
    });

    it('メッセージの途中で分けず、収まらないメッセージより古い画像も渡さない', () => {
      // 新しい順に 2 枚 → 3 枚（残り 1 枚に収まらない）→ 1 枚（収まるが、飛び飛びになるため渡さない）
      const result = selectChatImages(
        [ids('oldest', 1), ids('old', 3), ids('new', 2)],
        { supportsVision: true, maxImages: 3 }
      );
      expect(result.map((s) => s.includedIds)).toEqual([
        [],
        [],
        ['new-0', 'new-1'],
      ]);
      expect(result.map((s) => s.omittedCount)).toEqual([1, 3, 0]);
    });

    it('画像の無いメッセージは上限の判定に関わらない', () => {
      const result = selectChatImages([ids('a', 2), [], [], ids('b', 2)], {
        supportsVision: true,
        maxImages: 4,
      });
      expect(result.flatMap((s) => s.includedIds)).toHaveLength(4);
    });

    it('モデルが画像に対応していなければ、どの画像も渡さない', () => {
      const result = selectChatImages([ids('a', 1), [], ids('b', 2)], {
        supportsVision: false,
      });
      expect(result).toEqual([
        { includedIds: [], omittedCount: 1, omitReason: 'unsupported' },
        { includedIds: [], omittedCount: 0, omitReason: 'unsupported' },
        { includedIds: [], omittedCount: 2, omitReason: 'unsupported' },
      ]);
    });

    it('メッセージが 0 件なら空配列', () => {
      expect(selectChatImages([], { supportsVision: true })).toEqual([]);
    });
  });

  // 異常系: 入力は parseChatBody で検証済みの ID の配列だけで、失敗の経路を持たない（純粋な選択）。
  // 見つからない ID・非対応モデルへの送信の失敗は route の IT（chat-images.test.ts）で確かめる
});

describe('withOmittedImagesNote', () => {
  describe('正常系', () => {
    it('古いため渡さなかった画像の枚数を本文の末尾に注記する', () => {
      expect(
        withOmittedImagesNote('前の質問', {
          includedIds: [],
          omittedCount: 2,
          omitReason: 'old',
        })
      ).toBe('前の質問\n\n（画像 2 枚を添付。古いため省略）');
    });

    it('モデルが対応していないため渡さなかった画像を注記する', () => {
      expect(
        withOmittedImagesNote('前の質問', {
          includedIds: [],
          omittedCount: 1,
          omitReason: 'unsupported',
        })
      ).toBe(
        '前の質問\n\n（画像 1 枚を添付。このモデルは画像に対応していないため省略）'
      );
    });
  });

  describe('準正常系', () => {
    it('渡さなかった画像が無ければ本文のまま', () => {
      expect(
        withOmittedImagesNote('質問', {
          includedIds: ['a'],
          omittedCount: 0,
          omitReason: 'unsupported',
        })
      ).toBe('質問');
    });
  });

  // 異常系: 文字列を組み立てるだけで、失敗の経路を持たない
});
