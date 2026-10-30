import { describe, it, expect } from 'vitest';
import type { ToolCallInfo, ToolScreenshot } from '@/types/agent/tool-call';
import type { ToolContext } from '@/lib/agent/tools/types';
import { stripScreenshotData } from '@/lib/agent/agent';
import { clampBox, screenshotFromPng } from '@/lib/agent/tools/browser/capture';
import {
  restoreScreenshotData,
  screenshotAttachments,
  screenshotSrc,
  withoutScreenshotData,
} from '@/lib/chat/tool-screenshots';
import { parseMessageMetadata } from '@/lib/chat/message-metadata';
import { MAX_TOOL_SCREENSHOTS_PER_MESSAGE } from '@/lib/shared/validation';

/**
 * ブラウザの操作の画面をチャットに出す（#200。`docs/18-browser-tools.md`「画面をチャットに出す」）の純ロジックの UT。
 *
 * 要素の位置を画像に収めること・応答ごとの枚数の上限・記録から中身を外す／戻す・保存する画像の集め方・
 * 保存済みの記録の検証を確かめる。Chromium で撮る流れは IT（chat-agent-browser-screenshots.test.ts）、表示は E2E が担う。
 */

const VIEWPORT = { width: 1280, height: 800 };

/**
 * 応答ごとの文脈を作る（撮った枚数を数える `scope` だけを使う）。
 *
 * @returns 文脈
 */
function context(): ToolContext {
  return {
    scope: new Map(),
    onDispose: () => {},
    hasReadLocal: () => false,
  };
}

/**
 * スクリーンショットを作る。
 *
 * @param fields - 上書きする項目
 * @returns スクリーンショット
 */
function shot(fields: Partial<ToolScreenshot> = {}): ToolScreenshot {
  return {
    id: crypto.randomUUID(),
    kind: 'after',
    mimeType: 'image/jpeg',
    width: 1280,
    height: 800,
    ...fields,
  };
}

/**
 * ツール呼び出しの記録を作る。
 *
 * @param screenshots - 撮った画面
 * @returns 記録
 */
function call(screenshots?: ToolScreenshot[]): ToolCallInfo {
  return {
    name: 'browser_click',
    arguments: { ref: 'e1' },
    result: '操作しました',
    isError: false,
    durationMs: 10,
    ...(screenshots && { screenshots }),
  };
}

describe('正常系', () => {
  it('画面の中の要素の位置は、整数にしてそのまま使う', () => {
    expect(
      clampBox({ x: 8.4, y: 438.875, width: 55.59, height: 27 }, VIEWPORT)
    ).toEqual({ x: 8, y: 439, width: 56, height: 27 });
  });

  it('PNG（browser_screenshot）を、中身付きの画面にする', () => {
    const shown = screenshotFromPng(context(), Buffer.from('png'), VIEWPORT);
    expect(shown).toMatchObject({
      kind: 'after',
      mimeType: 'image/png',
      width: 1280,
      height: 800,
      data: Buffer.from('png').toString('base64'),
    });
  });

  it('中身があれば data: の URI、無ければ添付画像の取得 API で表示する', () => {
    const live = shot({ data: 'AAAA' });
    expect(screenshotSrc(live)).toBe('data:image/jpeg;base64,AAAA');
    const saved = shot();
    expect(screenshotSrc(saved)).toBe(`/api/attachments/${saved.id}`);
  });

  it('記録（done・DB）に入れるときは中身を外す（サーバー・画面とも）', () => {
    const shots = [
      shot({ data: 'AAAA' }),
      shot({ kind: 'before', data: 'BB' }),
    ];
    const strippedShots = stripScreenshotData(shots);
    expect(strippedShots?.map((s) => s.id)).toEqual(shots.map((s) => s.id));
    expect(strippedShots?.every((s) => !('data' in s))).toBe(true);
    const [stripped] = withoutScreenshotData([call(shots)]);
    expect(stripped.screenshots?.every((s) => s.data === undefined)).toBe(true);
  });

  it('中身のある画面を、記録の順に保存の attachments にする', () => {
    const first = shot({ kind: 'before', data: 'AAAA' });
    const second = shot({ data: 'BBBB' });
    expect(screenshotAttachments([call([first]), call([second])])).toEqual([
      { id: first.id, data: 'AAAA', width: 1280, height: 800 },
      { id: second.id, data: 'BBBB', width: 1280, height: 800 },
    ]);
  });

  it('done の記録（中身なし）に、届いた中身を ID で戻す', () => {
    const saved = shot();
    const [restored] = restoreScreenshotData(
      [call([saved])],
      new Map([[saved.id, 'AAAA']])
    );
    expect(restored.screenshots).toEqual([{ ...saved, data: 'AAAA' }]);
  });

  it('保存済みの記録のスクリーンショットを、位置付きで読み戻す', () => {
    const before = shot({
      kind: 'before',
      box: { x: 8, y: 439, width: 56, height: 27 },
    });
    const metadata = parseMessageMetadata({ toolCalls: [call([before])] });
    expect(metadata?.toolCalls?.[0].screenshots).toEqual([before]);
  });
});

describe('準正常系', () => {
  it('画面からはみ出した要素の位置は、画面の中に切り詰める', () => {
    expect(
      clampBox({ x: -10, y: 790, width: 100, height: 40 }, VIEWPORT)
    ).toEqual({ x: 0, y: 790, width: 90, height: 10 });
  });

  it('画面の外・大きさが 0 の要素には枠を出さない', () => {
    expect(
      clampBox({ x: 8, y: 2138, width: 55, height: 27 }, VIEWPORT)
    ).toBeUndefined();
    expect(
      clampBox({ x: 8, y: 10, width: 0, height: 27 }, VIEWPORT)
    ).toBeUndefined();
  });

  it(`1 回の応答で ${MAX_TOOL_SCREENSHOTS_PER_MESSAGE} 枚を撮ったら、それ以上は撮らない`, () => {
    const ctx = context();
    const shots = Array.from({ length: MAX_TOOL_SCREENSHOTS_PER_MESSAGE }, () =>
      screenshotFromPng(ctx, Buffer.from('png'), VIEWPORT)
    );
    expect(shots.every((s) => s !== undefined)).toBe(true);
    expect(
      screenshotFromPng(ctx, Buffer.from('png'), VIEWPORT)
    ).toBeUndefined();
    // 別の応答（新しい文脈）では、また撮れる
    expect(
      screenshotFromPng(context(), Buffer.from('png'), VIEWPORT)
    ).toBeDefined();
  });

  it('中身の無い画面と、同じ ID の画面は attachments に入れない', () => {
    const live = shot({ data: 'AAAA' });
    expect(
      screenshotAttachments([call([live, shot()]), call([live]), call()])
    ).toEqual([{ id: live.id, data: 'AAAA', width: 1280, height: 800 }]);
  });

  it('届いていない中身は戻さず、スクリーンショットの無い記録はそのまま', () => {
    const saved = shot();
    const plain = call();
    const [restored, untouched] = restoreScreenshotData(
      [call([saved]), plain],
      new Map()
    );
    expect(restored.screenshots).toEqual([saved]);
    expect(untouched).toBe(plain);
  });

  it('保存済みの記録に中身があっても読まない（表示は取得 API）', () => {
    const saved = shot();
    const metadata = parseMessageMetadata({
      toolCalls: [call([{ ...saved, data: 'AAAA' }])],
    });
    expect(metadata?.toolCalls?.[0].screenshots).toEqual([saved]);
  });

  it('位置の形が合わなければ、枠だけ捨てて画面は読む', () => {
    const saved = shot({ kind: 'before' });
    const metadata = parseMessageMetadata({
      toolCalls: [
        call([
          {
            ...saved,
            box: { x: -1, y: 0, width: 10, height: 10 },
          },
        ]),
      ],
    });
    expect(metadata?.toolCalls?.[0].screenshots).toEqual([saved]);
  });
});

describe('異常系', () => {
  it('保存済みの記録の、形の合わないスクリーンショットは捨てる', () => {
    const valid = shot();
    const metadata = parseMessageMetadata({
      toolCalls: [
        {
          ...call(),
          screenshots: [
            valid,
            { ...valid, id: 'not-a-uuid' },
            { ...valid, kind: 'during' },
            { ...valid, mimeType: 'image/svg+xml' },
            { ...valid, width: 0 },
            { ...valid, height: 1.5 },
            'image',
            null,
          ],
        },
      ],
    });
    expect(metadata?.toolCalls?.[0].screenshots).toEqual([valid]);
  });

  it('screenshots が配列でなければ、スクリーンショットを持たない記録にする', () => {
    const metadata = parseMessageMetadata({
      toolCalls: [{ ...call(), screenshots: 'image' }],
    });
    expect(metadata?.toolCalls?.[0]).not.toHaveProperty('screenshots');
  });
});
