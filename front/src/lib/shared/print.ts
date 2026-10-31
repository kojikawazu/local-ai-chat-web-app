/** iframe の読み込み・画像の読み込みを待つ上限（ms）。大きな画像を埋め込んだレポートでも、ふつうは 1 秒もかからない */
const LOAD_TIMEOUT_MS = 15_000;

/** 印刷のダイアログが閉じた合図（`afterprint`）が来ないブラウザで、iframe を残さないための上限（ms） */
const CLEANUP_TIMEOUT_MS = 60_000;

/**
 * iframe の中の画像がすべて読み込み終わるのを待つ（読み込みに失敗した画像も待ち終わりとする）。
 *
 * @param doc - iframe の文書
 * @returns 待ち終わったら解決する Promise
 */
function waitForImages(doc: Document): Promise<void> {
  const pending = Array.from(doc.images).filter((image) => !image.complete);
  return Promise.all(
    pending.map(
      (image) =>
        new Promise<void>((resolve) => {
          image.addEventListener('load', () => resolve(), { once: true });
          image.addEventListener('error', () => resolve(), { once: true });
        })
    )
  ).then(() => undefined);
}

/**
 * HTML の文書を、画面に出さない iframe に読み込んでブラウザの印刷のダイアログを開く（#36。PDF の書き出し）。
 *
 * 利用者が印刷の画面で「PDF として保存」を選ぶと PDF になる。iframe は `srcdoc` で読み込む（アプリと同じオリジン。
 * 文書はアプリの CSP を受け継ぐため、スクリプトの無い HTML・`data:` の画像・インラインの CSS だけを使う）。
 * 画像の読み込みを待ってから印刷し、印刷のダイアログが閉じたら（`afterprint`）iframe を消す。
 *
 * @param html - 印刷する HTML の文書（`<!doctype html>` から）
 * @returns 印刷のダイアログを開いたら解決する Promise
 * @throws {Error} iframe の読み込みが {@link LOAD_TIMEOUT_MS} 以内に終わらない・印刷を呼べない場合
 */
export async function printHtml(html: string): Promise<void> {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  // display: none の iframe は印刷できないブラウザがあるため、大きさを持たせて画面の外に置く
  iframe.style.cssText =
    'position:fixed;left:-10000px;top:0;width:800px;height:600px;border:0;';

  const loaded = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('印刷する文書を読み込めませんでした')),
      LOAD_TIMEOUT_MS
    );
    iframe.addEventListener(
      'load',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
  iframe.srcdoc = html;
  document.body.appendChild(iframe);

  const remove = () => iframe.remove();
  try {
    await loaded;
    const win = iframe.contentWindow;
    const doc = iframe.contentDocument;
    if (!win || !doc) throw new Error('印刷する文書を開けませんでした');
    await waitForImages(doc);
    win.addEventListener('afterprint', remove, { once: true });
    setTimeout(remove, CLEANUP_TIMEOUT_MS);
    win.focus();
    win.print();
  } catch (error) {
    remove();
    throw error;
  }
}
