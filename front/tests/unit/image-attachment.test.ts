import { describe, it, expect } from 'vitest';
import {
  base64FromDataUrl,
  fitWithinLongEdge,
  outputMimeType,
  selectFilesToAttach,
} from '@/lib/chat/image-attachment';
import {
  MAX_IMAGE_LONG_EDGE,
  MAX_IMAGE_SOURCE_BYTES,
  MAX_IMAGES_PER_MESSAGE,
} from '@/lib/shared/validation';

/**
 * `lib/chat/image-attachment` の UT（#6）。
 * 添付するファイルの選別（形式・大きさ・枚数）と、縮小の大きさ・出力の形式の決め方を確かめる。
 * 画像の読み込みと描き直し（`prepareImage`）はブラウザの API が要るため E2E（image-attachment.spec.ts）で確かめる。
 * 純関数のため mock は使わない。
 */

/**
 * 検証に要るところだけを持つファイルを作る（`File` の中身は判定に使わないため作らない）。
 *
 * @param name - ファイル名
 * @param type - MIME タイプ
 * @param size - バイト数（省略時は 1KB）
 * @returns ファイルの情報
 */
function file(name: string, type: string, size = 1024) {
  return { name, type, size };
}

describe('selectFilesToAttach', () => {
  describe('正常系', () => {
    it('PNG・JPEG・WebP・GIF は渡した順のまま添付を進める', () => {
      const files = [
        file('a.png', 'image/png'),
        file('b.jpg', 'image/jpeg'),
        file('c.webp', 'image/webp'),
        file('d.gif', 'image/gif'),
      ];
      expect(selectFilesToAttach(files, 0)).toEqual({
        accepted: files,
        errors: [],
      });
    });
  });

  describe('準正常系', () => {
    it('上限の枚数を超える分は、先のものを残して超えた枚数をまとめて伝える', () => {
      const files = [
        file('a.png', 'image/png'),
        file('b.png', 'image/png'),
        file('c.png', 'image/png'),
      ];
      const result = selectFilesToAttach(files, MAX_IMAGES_PER_MESSAGE - 1);
      expect(result.accepted).toEqual([files[0]]);
      expect(result.errors).toEqual([
        `画像は1メッセージにつき${MAX_IMAGES_PER_MESSAGE}枚までです（2枚を添付しませんでした）`,
      ]);
    });

    it('すでに上限まで添付していれば何も進めない', () => {
      const result = selectFilesToAttach(
        [file('a.png', 'image/png')],
        MAX_IMAGES_PER_MESSAGE
      );
      expect(result.accepted).toEqual([]);
      expect(result.errors).toHaveLength(1);
    });

    it('ちょうど上限の大きさのファイルは通す', () => {
      const exact = file('big.jpg', 'image/jpeg', MAX_IMAGE_SOURCE_BYTES);
      expect(selectFilesToAttach([exact], 0).accepted).toEqual([exact]);
    });

    it('空の一覧なら何も起きない', () => {
      expect(selectFilesToAttach([], 0)).toEqual({ accepted: [], errors: [] });
    });
  });

  describe('異常系', () => {
    it('画像でない・SVG のファイルは理由を付けて外し、ほかは進める', () => {
      const png = file('ok.png', 'image/png');
      const result = selectFilesToAttach(
        [
          file('memo.txt', 'text/plain'),
          file('icon.svg', 'image/svg+xml'),
          png,
        ],
        0
      );
      expect(result.accepted).toEqual([png]);
      expect(result.errors).toEqual([
        '「memo.txt」は添付できない形式です（PNG・JPEG・WebP・GIF のみ）',
        '「icon.svg」は添付できない形式です（PNG・JPEG・WebP・GIF のみ）',
      ]);
    });

    it('上限を超える大きさのファイルは外す', () => {
      const result = selectFilesToAttach(
        [file('huge.jpg', 'image/jpeg', MAX_IMAGE_SOURCE_BYTES + 1)],
        0
      );
      expect(result.accepted).toEqual([]);
      expect(result.errors).toEqual([
        '「huge.jpg」は20MBを超えているため添付できません',
      ]);
    });

    it('外した形式違いは枚数に数えない', () => {
      const files = [
        file('memo.txt', 'text/plain'),
        ...Array.from({ length: MAX_IMAGES_PER_MESSAGE }, (_, i) =>
          file(`${i}.png`, 'image/png')
        ),
      ];
      const result = selectFilesToAttach(files, 0);
      expect(result.accepted).toHaveLength(MAX_IMAGES_PER_MESSAGE);
      expect(result.errors).toHaveLength(1);
    });
  });
});

describe('fitWithinLongEdge', () => {
  describe('正常系', () => {
    it('横長の画像は幅を上限に合わせ、縦横比を保つ', () => {
      expect(fitWithinLongEdge(3840, 2160)).toEqual({
        width: MAX_IMAGE_LONG_EDGE,
        height: 720,
      });
    });

    it('縦長の画像は高さを上限に合わせる', () => {
      expect(fitWithinLongEdge(1000, 2000, 500)).toEqual({
        width: 250,
        height: 500,
      });
    });
  });

  describe('準正常系', () => {
    it('上限に収まっていれば元の大きさのまま（拡大しない）', () => {
      expect(fitWithinLongEdge(640, 480)).toEqual({ width: 640, height: 480 });
      expect(fitWithinLongEdge(MAX_IMAGE_LONG_EDGE, 10)).toEqual({
        width: MAX_IMAGE_LONG_EDGE,
        height: 10,
      });
    });
  });

  describe('異常系', () => {
    it('極端に細長い画像でも短辺を 0 にしない', () => {
      expect(fitWithinLongEdge(100_000, 1)).toEqual({
        width: MAX_IMAGE_LONG_EDGE,
        height: 1,
      });
    });
  });
});

describe('outputMimeType', () => {
  describe('正常系', () => {
    it('JPEG は JPEG のまま、PNG は PNG のまま', () => {
      expect(outputMimeType('image/jpeg')).toBe('image/jpeg');
      expect(outputMimeType('image/png')).toBe('image/png');
    });
  });

  describe('準正常系', () => {
    it('WebP・GIF はサーバーが受け付ける PNG にする', () => {
      expect(outputMimeType('image/webp')).toBe('image/png');
      expect(outputMimeType('image/gif')).toBe('image/png');
    });
  });

  // 異常系: 形式の検証は selectFilesToAttach が先に済ませるため、ここに届く不正な入力は無い
});

describe('base64FromDataUrl', () => {
  describe('正常系', () => {
    it('data: URI のカンマより後ろを返す', () => {
      expect(base64FromDataUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(
        'iVBORw0KGgo='
      );
    });
  });

  // 準正常系: 入力は FileReader の readAsDataURL の結果だけで、形の揺れが無い

  describe('異常系', () => {
    it('カンマの無い文字列なら空文字', () => {
      expect(base64FromDataUrl('not a data url')).toBe('');
    });
  });
});
