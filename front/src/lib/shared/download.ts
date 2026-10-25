/**
 * 文字列をファイルとして保存させる（ブラウザのダウンロード。#12）。
 *
 * `Blob` の URL を `<a download>` で開く。サーバーを経由しないため、表示中のデータをそのまま保存できる。
 * クリック等のユーザー操作の中で呼ぶ（操作の外で呼ぶと、ブラウザが複数のダウンロードを止めることがある）。
 *
 * @param fileName - 保存するファイル名
 * @param content - ファイルの中身
 * @param mimeType - `Blob` の種類（MIME タイプ）
 */
export function downloadTextFile(
  fileName: string,
  content: string,
  mimeType: string
): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 直後に解放すると、ブラウザによってはダウンロードが始まる前に URL が無効になるため、次の機会に解放する
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
