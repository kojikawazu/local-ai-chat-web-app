import { MAX_IMAGES_PER_REQUEST } from '@/lib/shared/validation';

/**
 * `/api/chat` で LLM へ渡す画像を選ぶ関数群（#6）。DB には触れない純関数で、読み込みは route が行う。
 *
 * 選び方は `docs/13-image-attachment.md`「LLM へ渡す画像の選び方」が正準。
 */

/** 画像を渡さなかった理由。本文に足す注記の文言が変わる。 */
export type OmitReason = 'old' | 'unsupported';

/** 1 件のメッセージについて、LLM へ渡す画像と渡さない画像の数。 */
export type ImageSelection = {
  /** LLM へ渡す添付の ID（メッセージ内の並び順のまま） */
  includedIds: string[];
  /** 渡さない画像の枚数（0 なら注記を足さない） */
  omittedCount: number;
  /** 渡さない理由（`omittedCount` が 0 のときは意味を持たない） */
  omitReason: OmitReason;
};

/** {@link selectChatImages} の選択の条件。 */
export type SelectOptions = {
  /** 使うモデルが画像に対応しているか */
  supportsVision: boolean;
  /** 合計で渡す画像の上限。省略時は {@link MAX_IMAGES_PER_REQUEST} */
  maxImages?: number;
};

/**
 * 時系列に並んだメッセージの添付から、LLM へ渡す画像を選ぶ。
 *
 * 新しいメッセージから順に、メッセージ単位で上限に収まる間だけ渡す。収まらないメッセージが出たら、
 * それより古いメッセージの画像も渡さない（新しいものを優先し、飛び飛びに古い画像を混ぜない）。
 * メッセージの途中で分けないのは、1 つの質問に添えた画像の一部だけを見せると答えが歪むため。
 * モデルが画像に対応していなければ、どの画像も渡さない（送信する質問に画像がある場合は route が先に 400 を返す）。
 *
 * @param imageIdsPerMessage - 各メッセージの添付 ID（古い順。最後が送信する質問）
 * @param options - モデルの対応と上限（{@link SelectOptions}）
 * @returns 各メッセージの選択結果（引数と同じ順・同じ件数）
 */
export function selectChatImages(
  imageIdsPerMessage: string[][],
  options: SelectOptions
): ImageSelection[] {
  const maxImages = options.maxImages ?? MAX_IMAGES_PER_REQUEST;
  const selections: ImageSelection[] = imageIdsPerMessage.map((ids) => ({
    includedIds: [],
    omittedCount: ids.length,
    omitReason: options.supportsVision ? 'old' : 'unsupported',
  }));
  if (!options.supportsVision) return selections;

  let remaining = maxImages;
  for (let index = imageIdsPerMessage.length - 1; index >= 0; index--) {
    const ids = imageIdsPerMessage[index];
    if (ids.length === 0) continue;
    if (ids.length > remaining) break;
    selections[index] = {
      includedIds: ids,
      omittedCount: 0,
      omitReason: 'old',
    };
    remaining -= ids.length;
  }
  return selections;
}

/**
 * LLM へ渡さなかった画像があることを、メッセージの本文の末尾に注記する。
 *
 * 画像を黙って外すと、モデルは「画像があった」こと自体を知らずに答える（「画像は見当たりません」等）。
 *
 * @param content - メッセージの本文
 * @param selection - そのメッセージの選択結果
 * @returns 渡さなかった画像があれば注記を足した本文。無ければ元の本文
 */
export function withOmittedImagesNote(
  content: string,
  selection: ImageSelection
): string {
  if (selection.omittedCount === 0) return content;
  const reason =
    selection.omitReason === 'unsupported'
      ? 'このモデルは画像に対応していないため省略'
      : '古いため省略';
  return `${content}\n\n（画像 ${selection.omittedCount} 枚を添付。${reason}）`;
}
