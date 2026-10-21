/**
 * {@link copyText} が使うブラウザ側の手段。UT で偽物を渡せるよう引数にしている。
 */
export type ClipboardEnv = {
  /**
   * Clipboard API（`navigator.clipboard`）。secure context（HTTPS / localhost）でしか
   * 存在せず、スマホから LAN の `http://192.168.x.x:3000` で開いた場合などは無い。
   */
  clipboard?: Pick<Clipboard, 'writeText'>;
  /** Clipboard API が使えない・失敗したときの代わりのコピー。成功したら true を返す */
  fallbackCopy: (text: string) => boolean;
};

/**
 * 画面外の textarea を選択して `document.execCommand('copy')` でコピーする。
 *
 * `execCommand` は非推奨だが、Clipboard API が無い非 secure context でコピーできる
 * 唯一の手段のため、代わりのコピーとしてだけ使う。クリック等のユーザー操作の中で
 * 呼ばれる必要がある。
 *
 * @param text - コピーする文字列
 * @returns コピーできたら true
 */
function copyWithExecCommand(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  // readonly にしてスマホでキーボードが開かないようにし、画面外に置いてちらつきを防ぐ
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  try {
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
}

/**
 * 実行中のブラウザの手段を返す。
 *
 * @returns `navigator.clipboard` と `execCommand` による代わりのコピー
 */
function browserEnv(): ClipboardEnv {
  return {
    // lib.dom の型では常に存在するが、非 secure context では実際には undefined になる
    clipboard: navigator.clipboard ?? undefined,
    fallbackCopy: copyWithExecCommand,
  };
}

/**
 * 文字列をクリップボードへコピーする。
 *
 * まず Clipboard API を使い、無い場合や拒否された場合（権限・フォーカス喪失）は
 * 代わりのコピーを試す。
 *
 * @param text - コピーする文字列
 * @param env - 使う手段。省略時は実行中のブラウザのもの
 * @throws {Error} どちらの手段でもコピーできなかった場合
 */
export async function copyText(
  text: string,
  env: ClipboardEnv = browserEnv()
): Promise<void> {
  let clipboardError: unknown;
  if (env.clipboard) {
    try {
      await env.clipboard.writeText(text);
      return;
    } catch (error) {
      clipboardError = error;
    }
  }

  let copied = false;
  try {
    copied = env.fallbackCopy(text);
  } catch {
    // execCommand が例外を投げるブラウザもある。失敗として下でまとめて扱う
  }
  if (!copied) {
    throw new Error('クリップボードへのコピーに失敗しました', {
      cause: clipboardError,
    });
  }
}
