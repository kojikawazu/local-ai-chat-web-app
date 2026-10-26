import { lstat, readFile, realpath, stat } from 'fs/promises';
import { createHash } from 'crypto';
import path from 'path';
import { describeRoots, findSecretSegment, isWithinRoot } from './path-guard';
import { isBinary } from './text';

/** 書き換える既存のファイルの最大バイト数（2MB。read_file と同じ） */
const MAX_EXISTING_BYTES = 2 * 1024 * 1024;

/** 書かせないフォルダ。`.git/hooks` を書き換えると、次の git の操作で任意のコードが実行されるため */
const UNWRITABLE_DIR_NAMES = new Set(['.git']);

/** {@link resolveWritablePath} の結果。 */
type WritableResult =
  | {
      ok: true;
      /** 書き込む先の実体のパス（新規なら、親のフォルダの実体のパス + 名前） */
      path: string;
      /** すでにファイルがあるか */
      exists: boolean;
    }
  | {
      ok: false;
      /** 書けない理由（モデルへ返す文章） */
      reason: string;
    };

/** {@link readExistingText} の結果。 */
type ExistingText =
  | {
      ok: true;
      /** 中身（UTF-8） */
      text: string;
      /** 中身のハッシュ（承認の間に変わっていないかの確認に使う） */
      hash: string;
    }
  | { ok: false; reason: string };

/**
 * 書き込む先のパスの途中に、書かせないフォルダ（`.git`）があるかを探す。
 *
 * @param target - 書き込む先（実体のパス）
 * @param root - それを含む書き込みのフォルダ（実体のパス）
 * @returns 見つかった名前。無ければ `null`
 */
export function findUnwritableSegment(
  target: string,
  root: string
): string | null {
  const segments = path.relative(root, target).split(path.sep);
  return segments.find((segment) => UNWRITABLE_DIR_NAMES.has(segment)) ?? null;
}

/**
 * 中身のハッシュを求める（SHA-256 の 16 進）。
 *
 * @param text - 中身
 * @returns ハッシュ
 */
export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * ツールに渡されたパスを、書き込みのフォルダの中の書き込む先にする（#148 Phase A2）。
 *
 * まだ無いファイルは `realpath` できないため、親のフォルダを実体のパスにしてから名前を足す。
 * 既にあるファイルは、ファイルそのものを実体のパスにする（シンボリックリンクの先で判定する）。
 * 先の無いシンボリックリンクは、書くと外へ出うるため断る。書き込みのフォルダの外・秘匿ファイル・
 * `.git` の中も断る。
 *
 * @param value - モデルが渡したパス
 * @param roots - 書き込みのフォルダ（実体のパス）
 * @returns 書き込む先と、既にあるか。書けなければ理由
 */
export async function resolveWritablePath(
  value: unknown,
  roots: string[]
): Promise<WritableResult> {
  if (typeof value !== 'string' || value.trim() === '') {
    return {
      ok: false,
      reason: `path を指定してください。書き込めるフォルダ: ${describeRoots(roots)}`,
    };
  }
  const requested = value.trim();
  if (requested.includes('\0')) {
    return { ok: false, reason: 'path に使えない文字が含まれています' };
  }
  if (!path.isAbsolute(requested)) {
    return {
      ok: false,
      reason: `path は絶対パスで指定してください（「${requested}」）。書き込めるフォルダ: ${describeRoots(roots)}`,
    };
  }

  let target: string;
  let exists: boolean;
  try {
    target = await realpath(requested);
    exists = true;
  } catch {
    // 無い、または先の無いシンボリックリンク。リンクそのものがあれば、書くとリンクの先（外かもしれない）に出る
    const isLink = await lstat(requested)
      .then((info) => info.isSymbolicLink())
      .catch(() => false);
    if (isLink) {
      return {
        ok: false,
        reason: `「${requested}」は先の無いシンボリックリンクのため書き込めません`,
      };
    }
    try {
      const parent = await realpath(path.dirname(requested));
      target = path.join(parent, path.basename(requested));
      exists = false;
    } catch {
      return {
        ok: false,
        reason: `「${path.dirname(requested)}」が見つかりません（フォルダは作れません）`,
      };
    }
  }

  const root = roots.find((candidate) => isWithinRoot(target, candidate));
  if (!root || target === root) {
    return {
      ok: false,
      reason: `「${requested}」は書き込めるフォルダの外です。書き込めるフォルダ: ${describeRoots(roots)}`,
    };
  }
  const secretSegment = findSecretSegment(target, root);
  if (secretSegment) {
    return {
      ok: false,
      reason: `「${requested}」は秘匿情報を含みうるため書き込めません（${secretSegment}）`,
    };
  }
  const unwritable = findUnwritableSegment(target, root);
  if (unwritable) {
    return {
      ok: false,
      reason: `「${requested}」は ${unwritable} の中のため書き込めません`,
    };
  }
  return { ok: true, path: target, exists };
}

/**
 * 書き換える既存のファイルを読む。
 *
 * @param file - ファイルの実体のパス
 * @returns 中身とハッシュ。ファイルでない・大きすぎる・バイナリ・読めなければ理由
 */
export async function readExistingText(file: string): Promise<ExistingText> {
  try {
    const info = await stat(file);
    if (!info.isFile()) {
      return { ok: false, reason: `「${file}」はファイルではありません` };
    }
    if (info.size > MAX_EXISTING_BYTES) {
      return {
        ok: false,
        reason: `「${file}」は大きすぎるため書き換えられません（上限 2MB）`,
      };
    }
    const bytes = await readFile(file);
    if (isBinary(bytes)) {
      return {
        ok: false,
        reason: `「${file}」はバイナリのため書き換えられません`,
      };
    }
    const text = bytes.toString('utf8');
    return { ok: true, text, hash: hashText(text) };
  } catch {
    return { ok: false, reason: `「${file}」を読めません` };
  }
}
