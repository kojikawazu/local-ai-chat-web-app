import type { PreparedImage } from '@/types/chat/attachment';
import { ACCEPTED_IMAGE_TYPES } from '@/constants/chat/imageAttachment';
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_LONG_EDGE,
  MAX_IMAGE_SOURCE_BYTES,
  MAX_IMAGES_PER_MESSAGE,
} from '@/lib/shared/validation';

/** JPEG に再エンコードするときの品質（0〜1）。文字の多いスクリーンショットでも滲みが目立たない値 */
const JPEG_QUALITY = 0.9;

/** 再エンコードの出力の形式。サーバーが受け付ける 2 つだけ（`lib/server/attachment.ts`） */
type OutputMimeType = 'image/png' | 'image/jpeg';

/** 添付の検証に要るファイルの情報（`File` の一部。UT で `File` を作らずに済むように絞る）。 */
type FileLike = Pick<File, 'name' | 'type' | 'size'>;

/** {@link selectFilesToAttach} の結果。 */
type FileSelection<T extends FileLike> = {
  /** 添付を進めるファイル（渡した順） */
  accepted: T[];
  /** 添付しなかった理由（画面に出す文言。1 件ごと、枚数の超過はまとめて 1 件） */
  errors: string[];
};

/**
 * 1 つのファイルを添付できるかを、形式と大きさで判定する。
 *
 * @param file - 判定するファイル
 * @returns 添付できなければ理由。できれば `null`
 */
function checkImageFile(file: FileLike): string | null {
  // includes はリテラルの union の配列に string を渡せないため、読み取り専用の string の配列として見る（値は変えない）
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return `「${file.name}」は添付できない形式です（PNG・JPEG・WebP・GIF のみ）`;
  }
  if (file.size > MAX_IMAGE_SOURCE_BYTES) {
    const limitMb = MAX_IMAGE_SOURCE_BYTES / 1024 / 1024;
    return `「${file.name}」は${limitMb}MBを超えているため添付できません`;
  }
  return null;
}

/**
 * 選んだ・落とした・貼り付けたファイルから、添付を進めるものを選ぶ（#6）。
 *
 * 形式・大きさが合わないものは理由を付けて外す。1 メッセージの枚数の上限（{@link MAX_IMAGES_PER_MESSAGE}）を
 * 超える分は、先に渡したものを優先して残し、超えた枚数をまとめて 1 件の理由にする。
 *
 * @param files - 添付しようとしたファイル（渡した順）
 * @param currentCount - すでに添付している（準備中を含む）枚数
 * @returns 添付を進めるファイルと、外した理由
 */
export function selectFilesToAttach<T extends FileLike>(
  files: T[],
  currentCount: number
): FileSelection<T> {
  const errors: string[] = [];
  const valid: T[] = [];
  for (const file of files) {
    const error = checkImageFile(file);
    if (error) errors.push(error);
    else valid.push(file);
  }
  const room = Math.max(0, MAX_IMAGES_PER_MESSAGE - currentCount);
  if (valid.length > room) {
    errors.push(
      `画像は1メッセージにつき${MAX_IMAGES_PER_MESSAGE}枚までです（${valid.length - room}枚を添付しませんでした）`
    );
  }
  return { accepted: valid.slice(0, room), errors };
}

/**
 * 長辺が上限に収まる大きさを求める。収まっていれば元の大きさのまま（拡大しない）。
 *
 * @param width - 元の幅（px）
 * @param height - 元の高さ（px）
 * @param maxLongEdge - 長辺の上限（px）。省略時は {@link MAX_IMAGE_LONG_EDGE}
 * @returns 縮小後の幅と高さ（整数。細長い画像でも 1px より小さくしない）
 */
export function fitWithinLongEdge(
  width: number,
  height: number,
  maxLongEdge: number = MAX_IMAGE_LONG_EDGE
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdge) return { width, height };
  const scale = maxLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * 再エンコードの出力の形式を決める。JPEG は JPEG のまま（写真を PNG にすると何倍にも膨らむ）、
 * それ以外（PNG・WebP・GIF）は PNG にする（透明を保つ。GIF は最初のフレームだけになる）。
 *
 * @param sourceType - 元のファイルの MIME タイプ
 * @returns 出力の MIME タイプ
 */
export function outputMimeType(sourceType: string): OutputMimeType {
  return sourceType === 'image/jpeg' ? 'image/jpeg' : 'image/png';
}

/**
 * data: URI から Base64 の部分を取り出す。
 *
 * @param dataUrl - `data:<型>;base64,<中身>` の URI
 * @returns `,` より後ろの Base64。`,` が無ければ空文字
 */
export function base64FromDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma < 0 ? '' : dataUrl.slice(comma + 1);
}

/**
 * `<canvas>` の中身を指定の形式の `Blob` にする。
 *
 * @param canvas - 描き終えた canvas
 * @param type - 出力の形式
 * @returns 画像の `Blob`
 * @throws {Error} 書き出せなかった場合（大きすぎる canvas などで `toBlob` が `null` を渡す）
 */
function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: OutputMimeType
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('画像を書き出せませんでした'));
      },
      type,
      JPEG_QUALITY
    );
  });
}

/**
 * `Blob` を data: URI として読む。
 *
 * @param blob - 読む `Blob`
 * @returns data: URI
 * @throws {Error} 読めなかった場合
 */
function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('画像を読めませんでした'));
    reader.readAsDataURL(blob);
  });
}

/**
 * 添付する画像を、送れる形に整える（ブラウザ専用。#6）。
 *
 * 画像を読み、長辺が {@link MAX_IMAGE_LONG_EDGE}px を超えていれば縮小して、PNG か JPEG に描き直す。
 * 縮小が要らない画像も必ず描き直す。EXIF（撮影場所の GPS など）を落とすため。向きは
 * `createImageBitmap` が EXIF の向きを反映してから描くため崩れない。
 *
 * @param file - 添付するファイル（{@link selectFilesToAttach} で形式・大きさを確かめたもの）
 * @returns 添付の ID・表示用の data: URI・保存 API へ送る Base64・縮小後の大きさ
 * @throws {Error} 画像として読めない・書き出せない・書き出した画像が {@link MAX_IMAGE_BYTES} を超える場合
 *   （`message` は画面にそのまま出す文言）
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(`「${file.name}」を画像として読み込めませんでした`);
  }

  try {
    const size = fitWithinLongEdge(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas を使えませんでした');
    context.drawImage(bitmap, 0, 0, size.width, size.height);

    const blob = await canvasToBlob(canvas, outputMimeType(file.type));
    if (blob.size > MAX_IMAGE_BYTES) {
      const limitMb = MAX_IMAGE_BYTES / 1024 / 1024;
      throw new Error(
        `「${file.name}」は縮小しても${limitMb}MBを超えるため添付できません`
      );
    }
    const src = await readAsDataUrl(blob);
    return {
      id: crypto.randomUUID(),
      src,
      data: base64FromDataUrl(src),
      width: size.width,
      height: size.height,
    };
  } finally {
    bitmap.close();
  }
}
