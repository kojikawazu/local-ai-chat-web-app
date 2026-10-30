import type { ToolCallInfo, ToolScreenshot } from '@/types/agent/tool-call';
import type { PreparedImage } from '@/types/chat/attachment';

/** 保存 API の `attachments` に送る画像 1 枚 */
type ScreenshotAttachment = Pick<
  PreparedImage,
  'id' | 'data' | 'width' | 'height'
>;

/**
 * スクリーンショットを表示する URL を返す（#200）。
 *
 * 生成中・保存前は中身（`data`）を持つため `data:` の URI にし、読み込んだ会話は添付画像の取得 API で表示する。
 *
 * @param shot - スクリーンショット
 * @returns `<img>` の `src`
 */
export function screenshotSrc(shot: ToolScreenshot): string {
  return shot.data
    ? `data:${shot.mimeType};base64,${shot.data}`
    : `/api/attachments/${shot.id}`;
}

/**
 * 記録から、スクリーンショットの中身を外す（#200）。保存する `metadata` には中身を入れない（添付画像として別に送る）。
 *
 * @param toolCalls - ツール呼び出しの記録
 * @returns 中身を外した記録（元の配列は変えない）
 */
export function withoutScreenshotData(
  toolCalls: ToolCallInfo[]
): ToolCallInfo[] {
  return toolCalls.map((call) =>
    call.screenshots
      ? {
          ...call,
          // data は分割代入で外す
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          screenshots: call.screenshots.map(({ data, ...shot }) => shot),
        }
      : call
  );
}

/**
 * 記録のスクリーンショットのうち中身を持つものを、保存 API の `attachments` にする（#200）。
 *
 * サーバーが撮る枚数は 1 回の応答で上限（`MAX_TOOL_SCREENSHOTS_PER_MESSAGE`）までのため、ここでは数を絞らない。
 * 同じ ID は 1 度だけ送る。
 *
 * @param toolCalls - ツール呼び出しの記録
 * @returns 保存する画像（記録の順）
 */
export function screenshotAttachments(
  toolCalls: ToolCallInfo[]
): ScreenshotAttachment[] {
  const attachments: ScreenshotAttachment[] = [];
  for (const call of toolCalls) {
    for (const { id, data, width, height } of call.screenshots ?? []) {
      if (!data || attachments.some((attachment) => attachment.id === id)) {
        continue;
      }
      attachments.push({ id, data, width, height });
    }
  }
  return attachments;
}

/**
 * `done` で届いた記録（中身なし）に、`tool_call_result` で届いた中身を ID で戻す（#200）。
 * 保存の前に `done` の記録で表示を置き換えても、画像が消えないように。
 *
 * @param toolCalls - `done` で届いた記録
 * @param data - スクリーンショットの ID → 中身
 * @returns 中身を戻した記録（元の配列は変えない）
 */
export function restoreScreenshotData(
  toolCalls: ToolCallInfo[],
  data: ReadonlyMap<string, string>
): ToolCallInfo[] {
  return toolCalls.map((call) =>
    call.screenshots
      ? {
          ...call,
          screenshots: call.screenshots.map((shot) => {
            const restored = data.get(shot.id);
            return restored ? { ...shot, data: restored } : shot;
          }),
        }
      : call
  );
}
