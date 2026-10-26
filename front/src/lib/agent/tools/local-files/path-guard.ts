import { realpath } from 'fs/promises';
import path from 'path';

/**
 * 秘匿ファイルの名前（#148）。CI の Secret scan（`.github/workflows/secret-scan.yml` の `SECRET_PATTERN`）と
 * 同じ範囲を、パスではなくファイル名 1 つに当てる形にしたもの。変えるときは両方を揃える。
 */
const SECRET_FILE_PATTERN =
  /^(\.env(\..+)?|.+\.(key|pem|p12|pfx|jks|keystore)|id_rsa|id_ed25519|id_dsa|credentials\.json|serviceAccountKey\.json)$/;

/** 秘匿ファイルの名前でも、テンプレート・型定義は除く（Secret scan の `ALLOW_PATTERN` と同じ） */
const SECRET_ALLOW_PATTERN = /\.(example|sample|template|dist)$|\.env\.d\.ts$/;

/** 中身を丸ごと読ませないフォルダ（鍵・クラウドの認証情報の置き場所） */
const SECRET_DIR_NAMES = new Set([
  '.ssh',
  '.gnupg',
  '.aws',
  '.kube',
  '.docker',
]);

/**
 * 検索でたどらないフォルダ（生成物・依存。量が多く、検索の上限をすぐに使い切るため）。
 * 読み取り・一覧で直接指定することは止めない。
 */
const SKIPPED_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.venv',
  '__pycache__',
  '.turbo',
  '.cache',
]);

/** {@link resolveAllowedPath} の結果。 */
type ResolveResult =
  | {
      ok: true;
      /** 実体のパス（シンボリックリンク・`..` を解決したもの） */
      path: string;
    }
  | {
      ok: false;
      /** 使えない理由（モデルへ返す文章） */
      reason: string;
    };

/**
 * ファイル名が秘匿ファイルのものかを判定する。
 *
 * @param name - ファイル名（パスではなく末尾の 1 つ）
 * @returns 秘匿ファイルなら true
 */
export function isSecretFileName(name: string): boolean {
  return SECRET_FILE_PATTERN.test(name) && !SECRET_ALLOW_PATTERN.test(name);
}

/**
 * フォルダ名が、中身を読ませないフォルダのものかを判定する。
 *
 * @param name - フォルダ名
 * @returns 読ませないフォルダなら true
 */
export function isSecretDirName(name: string): boolean {
  return SECRET_DIR_NAMES.has(name);
}

/**
 * フォルダ名が、検索でたどらないフォルダのものかを判定する。
 *
 * @param name - フォルダ名
 * @returns たどらないフォルダなら true
 */
export function isSkippedDirName(name: string): boolean {
  return SKIPPED_DIR_NAMES.has(name);
}

/**
 * パスが、あるフォルダの中（フォルダそのものを含む）にあるかを判定する。どちらも実体のパスで渡す。
 *
 * 文字列の前方一致では `/a/b` と `/a/bc` を取り違えるため、`path.relative` の結果で判定する。
 *
 * @param target - 判定するパス
 * @param root - フォルダ
 * @returns 中にあれば true
 */
export function isWithinRoot(target: string, root: string): boolean {
  const relative = path.relative(root, target);
  if (relative === '') return true;
  return (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/**
 * フォルダからパスまでの途中の名前に、秘匿ファイル・読ませないフォルダの名前が無いかを探す。
 *
 * @param target - 判定するパス（実体のパス）
 * @param root - それを含むフォルダ（実体のパス）
 * @returns 見つかった名前。無ければ `null`
 */
export function findSecretSegment(target: string, root: string): string | null {
  const segments = path.relative(root, target).split(path.sep).filter(Boolean);
  for (const [index, segment] of segments.entries()) {
    const isLast = index === segments.length - 1;
    if (isSecretDirName(segment) || (isLast && isSecretFileName(segment))) {
      return segment;
    }
  }
  return null;
}

/**
 * 許可したフォルダの一覧を、モデルへ返す文章に入れる形にする。
 *
 * @param roots - 許可したフォルダ
 * @returns `「/a」・「/b」` の形の文字列
 */
export function describeRoots(roots: string[]): string {
  return roots.map((root) => `「${root}」`).join('・');
}

/**
 * ツールに渡されたパスを、許可したフォルダの中の実体のパスにする（#148）。
 *
 * 文字列・絶対パス・NUL を含まないことを確かめてから `realpath` で実体にし（シンボリックリンク・`..` を解決）、
 * 許可したフォルダのどれかの中にあること、途中に秘匿ファイル・読ませないフォルダの名前が無いことを確かめる。
 *
 * @param value - モデルが渡したパス
 * @param roots - 許可したフォルダ（実体のパス）
 * @returns 実体のパス。使えなければ理由
 */
export async function resolveAllowedPath(
  value: unknown,
  roots: string[]
): Promise<ResolveResult> {
  if (typeof value !== 'string' || value.trim() === '') {
    return {
      ok: false,
      reason: `path を指定してください。使えるフォルダ: ${describeRoots(roots)}`,
    };
  }
  const requested = value.trim();
  if (requested.includes('\0')) {
    return { ok: false, reason: 'path に使えない文字が含まれています' };
  }
  if (!path.isAbsolute(requested)) {
    return {
      ok: false,
      reason: `path は絶対パスで指定してください（「${requested}」）。使えるフォルダ: ${describeRoots(roots)}`,
    };
  }

  let real: string;
  try {
    real = await realpath(requested);
  } catch {
    return { ok: false, reason: `「${requested}」が見つかりません` };
  }

  const root = roots.find((candidate) => isWithinRoot(real, candidate));
  if (!root) {
    return {
      ok: false,
      reason: `「${requested}」は読んでよいフォルダの外です。使えるフォルダ: ${describeRoots(roots)}`,
    };
  }
  const secretSegment = findSecretSegment(real, root);
  if (secretSegment) {
    return {
      ok: false,
      reason: `「${requested}」は秘匿情報を含みうるため読めません（${secretSegment}）`,
    };
  }
  return { ok: true, path: real };
}
