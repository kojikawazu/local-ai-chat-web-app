/** {@link svgToPngBlob} の出力の指定。 */
type PngOptions = {
  /** PNG の幅（px） */
  width: number;
  /** PNG の高さ（px） */
  height: number;
  /** 図の下に塗る色（CSS の色の値）。省略時は塗らない（透明のまま） */
  background?: string;
};

/**
 * data: URI の画像を読み込む。
 *
 * @param src - 画像の URI
 * @returns 読み込んだ `<img>`
 * @throws {Error} 画像として読み込めなかった場合
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('画像を読み込めませんでした'));
    image.src = src;
  });
}

/**
 * SVG の画像を `<canvas>` に描いて PNG にする（#176）。
 *
 * SVG は data: URI の `<img>` で読み込むため、外部の資源は読まれず、`<canvas>` も汚染されない
 * （`<foreignObject>` を含む SVG は、ブラウザによっては汚染されて書き出せない。Mermaid は `htmlLabels: false` で描く）。
 *
 * @param src - SVG の data: URI
 * @param options - PNG の大きさと背景の色
 * @returns PNG の `Blob`
 * @throws {Error} 画像を読み込めない・`<canvas>` を使えない・PNG にできなかった場合
 */
export async function svgToPngBlob(
  src: string,
  { width, height, background }: PngOptions
): Promise<Blob> {
  const image = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas を使えませんでした');
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(image, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    // 大きすぎる canvas などで書き出せないとき、toBlob は例外を投げずに null を渡す
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('画像を書き出せませんでした'));
    }, 'image/png');
  });
}
