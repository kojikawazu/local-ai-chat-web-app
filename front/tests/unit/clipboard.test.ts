import { describe, it, expect, vi } from 'vitest';
import { copyText } from '@/lib/shared/clipboard';

/**
 * `lib/shared/clipboard` の UT。Clipboard API と代わりのコピー（execCommand）はブラウザの
 * 外部 I/O のため偽物を渡し、「どの手段をどの順で試し、いつ失敗とするか」の判断だけを
 * 検証する。代わりのコピーが実際のブラウザで動くことは E2E（copy.spec.ts）が担う。
 */
describe('copyText', () => {
  describe('正常系', () => {
    it('Clipboard API で書き込めたら、代わりのコピーは使わない', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      const fallbackCopy = vi.fn().mockReturnValue(true);

      await copyText('hello', { clipboard: { writeText }, fallbackCopy });

      expect(writeText).toHaveBeenCalledWith('hello');
      expect(fallbackCopy).not.toHaveBeenCalled();
    });
  });

  describe('準正常系', () => {
    it('Clipboard API が無い（非 secure context）場合は、代わりのコピーで書き込む', async () => {
      const fallbackCopy = vi.fn().mockReturnValue(true);

      await copyText('hello', { clipboard: undefined, fallbackCopy });

      expect(fallbackCopy).toHaveBeenCalledWith('hello');
    });

    it('Clipboard API が拒否された場合は、代わりのコピーで書き込む', async () => {
      const writeText = vi
        .fn()
        .mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
      const fallbackCopy = vi.fn().mockReturnValue(true);

      await expect(
        copyText('hello', { clipboard: { writeText }, fallbackCopy })
      ).resolves.toBeUndefined();
      expect(fallbackCopy).toHaveBeenCalledWith('hello');
    });
  });

  describe('異常系', () => {
    it('Clipboard API が無く、代わりのコピーも失敗したら例外を投げる', async () => {
      const fallbackCopy = vi.fn().mockReturnValue(false);

      await expect(
        copyText('hello', { clipboard: undefined, fallbackCopy })
      ).rejects.toThrow('クリップボードへのコピーに失敗しました');
    });

    it('両方失敗した場合、Clipboard API の失敗理由を cause に残す', async () => {
      const denied = new DOMException('denied', 'NotAllowedError');
      const writeText = vi.fn().mockRejectedValue(denied);
      const fallbackCopy = vi.fn().mockReturnValue(false);

      await expect(
        copyText('hello', { clipboard: { writeText }, fallbackCopy })
      ).rejects.toMatchObject({ cause: denied });
    });

    it('代わりのコピーが例外を投げても、コピー失敗の例外にまとめる', async () => {
      const fallbackCopy = vi.fn(() => {
        throw new Error('execCommand is not supported');
      });

      await expect(
        copyText('hello', { clipboard: undefined, fallbackCopy })
      ).rejects.toThrow('クリップボードへのコピーに失敗しました');
    });
  });
});
