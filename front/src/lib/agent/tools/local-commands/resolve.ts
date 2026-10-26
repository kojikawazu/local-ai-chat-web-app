import { constants } from 'fs';
import { access, realpath, stat } from 'fs/promises';
import path from 'path';
import {
  describeRoots,
  findSecretSegment,
  isWithinRoot,
} from '../local-files/path-guard';
import { findUnwritableSegment } from '../local-files/write-guard';
import { isDeniedProgram } from './config';

/** {@link findExecutable}・{@link resolveWorkingDir} の結果。 */
type ResolveResult =
  | {
      ok: true;
      /** 実体のパス */
      path: string;
    }
  | {
      ok: false;
      /** 使えない理由（モデルへ返す文章） */
      reason: string;
    };

/**
 * プログラムの名前を、`PATH` のフォルダから探して実行ファイルの実体のパスにする（#148 Phase B）。
 *
 * 承認カードには実体のパスを見せ、許可されたらそのパスを実行する（シェルの `PATH` の探索に任せない）。
 * 実体がシェル等（{@link isDeniedProgram}）なら断る（許可した名前がシェルへのリンクだった場合）。
 *
 * @param name - プログラムの名前（`/` を含まない。許可リストで確かめ済み）
 * @param pathEnv - 探すフォルダ（`PATH` の値。`:` 区切り）
 * @returns 実行ファイルの実体のパス。見つからなければ理由
 */
export async function findExecutable(
  name: string,
  pathEnv: string | undefined
): Promise<ResolveResult> {
  for (const dir of (pathEnv ?? '').split(path.delimiter)) {
    if (!path.isAbsolute(dir)) continue; // 相対のフォルダ（空・`.`）は、起動の仕方で変わるため探さない
    const candidate = path.join(dir, name);
    try {
      await access(candidate, constants.X_OK);
      const real = await realpath(candidate);
      if (!(await stat(real)).isFile()) continue;
      if (isDeniedProgram(path.basename(real))) {
        return {
          ok: false,
          reason: `「${name}」の実体（${real}）はシェル・別のプログラムを起動するもののため実行できません`,
        };
      }
      return { ok: true, path: real };
    } catch {
      // このフォルダには無い・実行できない。次のフォルダを探す
    }
  }
  return { ok: false, reason: `「${name}」が見つかりません（PATH に無い）` };
}

/**
 * 作業フォルダを、書き込みのフォルダの中の実体のパスにする（#148 Phase B）。
 *
 * コマンドはファイルを書き換えうるため、書き込んでよいフォルダ（`LOCAL_FILE_WRITE_ROOTS`）より広くしない。
 * `realpath` で実体にしてから包含を判定し、秘匿フォルダ・`.git` の中も断る。
 *
 * @param value - モデルが渡した作業フォルダ
 * @param roots - 書き込みのフォルダ（実体のパス）
 * @returns 作業フォルダの実体のパス。使えなければ理由
 */
export async function resolveWorkingDir(
  value: unknown,
  roots: string[]
): Promise<ResolveResult> {
  if (typeof value !== 'string' || value.trim() === '') {
    return {
      ok: false,
      reason: `cwd に作業フォルダを指定してください。使えるフォルダ: ${describeRoots(roots)}`,
    };
  }
  const requested = value.trim();
  if (requested.includes('\0')) {
    return { ok: false, reason: 'cwd に使えない文字が含まれています' };
  }
  if (!path.isAbsolute(requested)) {
    return {
      ok: false,
      reason: `cwd は絶対パスで指定してください（「${requested}」）。使えるフォルダ: ${describeRoots(roots)}`,
    };
  }

  let real: string;
  try {
    real = await realpath(requested);
    if (!(await stat(real)).isDirectory()) {
      return { ok: false, reason: `「${requested}」はフォルダではありません` };
    }
  } catch {
    return { ok: false, reason: `「${requested}」が見つかりません` };
  }

  const root = roots.find((candidate) => isWithinRoot(real, candidate));
  if (!root) {
    return {
      ok: false,
      reason: `「${requested}」はコマンドを実行できるフォルダの外です。使えるフォルダ: ${describeRoots(roots)}`,
    };
  }
  const blocked =
    findSecretSegment(real, root) ?? findUnwritableSegment(real, root);
  if (blocked) {
    return {
      ok: false,
      reason: `「${requested}」ではコマンドを実行できません（${blocked}）`,
    };
  }
  return { ok: true, path: real };
}
