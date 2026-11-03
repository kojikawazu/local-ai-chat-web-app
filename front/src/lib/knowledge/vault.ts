import path from 'path';
import {
  isSecretDirName,
  isSecretFileName,
} from '@/lib/agent/tools/local-files/path-guard';
import { knowledgeFileKind } from '@/lib/knowledge/file';
import type { KnowledgeFileKind } from '@/lib/knowledge/file';
import type {
  VaultExclusionReason,
  VaultSyncPlan,
} from '@/types/knowledge/vault';

/**
 * 保管庫（#235）の規則の純関数。取り込まないファイルの判定・パスの検証・差分の計算。
 *
 * 設計は `docs/28-rag.md`「保管庫の同期（Phase C）」。fs・git・DB には触れない。
 */

/** エージェントの設定のファイル（ノートではないので取り込まない。どの階層でも） */
const AGENT_CONFIG_FILE_NAMES = new Set(['CLAUDE.md', 'AGENTS.md']);

/** 保管庫の中のパスの最大文字数（DB の名前・出典に出す長さ。手元の 3 つの最長は 79） */
const MAX_VAULT_PATH_LENGTH = 500;

/** 制御文字（パスに入れさせない） */
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

/**
 * 保管庫の名前（API のパスの `[name]`）として受け付ける形かを判定する（#235）。
 *
 * 名前はフォルダ名なので、空・`/`・`\`・制御文字・`.` と `..` は来ない。来たら DB を読む前に断る。
 *
 * @param name - パスから受けた名前
 * @returns 受け付けるなら true
 */
export function isValidVaultName(name: string): boolean {
  return (
    name !== '' &&
    name !== '.' &&
    name !== '..' &&
    [...name].length <= 255 &&
    !/[/\\]/.test(name) &&
    !CONTROL_CHARACTER.test(name)
  );
}

/** {@link normalizeVaultPath} の結果。 */
export type VaultPathResult =
  { ok: true; path: string } | { ok: false; error: string };

/**
 * 保管庫の中のパス（API が受けたもの）を検証する（#235）。
 *
 * `/` 区切りの相対パスだけを受け付ける。絶対パス・`..`・`.`・空の区切り・`\`・制御文字（NUL を含む）は断る。
 * 保管庫の外を指せる形を、fs に触る前に断るため。
 *
 * @param value - API が受けた値
 * @returns 検証を通ったパス（そのまま）。通らなければ理由
 */
export function normalizeVaultPath(value: unknown): VaultPathResult {
  if (typeof value !== 'string' || value === '') {
    return { ok: false, error: 'pathを指定してください' };
  }
  if (value.length > MAX_VAULT_PATH_LENGTH) {
    return {
      ok: false,
      error: `pathは${MAX_VAULT_PATH_LENGTH}文字以内で指定してください`,
    };
  }
  if (CONTROL_CHARACTER.test(value) || value.includes('\\')) {
    return { ok: false, error: 'pathに使えない文字があります' };
  }
  const segments = value.split('/');
  if (
    value.startsWith('/') ||
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..'
    )
  ) {
    return {
      ok: false,
      error: 'pathは保管庫の中の相対パス（/ 区切り）で指定してください',
    };
  }
  return { ok: true, path: value };
}

/**
 * 保管庫のファイルを取り込まない理由を、パスから決める（#235。`docs/28-rag.md` の C3）。
 *
 * 大きさ（1 MB）は中身を読む側で見る。
 *
 * @param relativePath - 保管庫の中のパス（`/` 区切り。{@link normalizeVaultPath} を通ったもの）
 * @returns 取り込まない理由。取り込むなら `null`
 */
export function vaultExclusionReason(
  relativePath: string
): VaultExclusionReason | null {
  const segments = relativePath.split('/');
  const fileName = segments[segments.length - 1];
  const dirs = segments.slice(0, -1);
  // `.` で始まるフォルダ（.claude・.github・.git・.ssh 等）の中は読まない
  if (dirs.some((dir) => dir.startsWith('.') || isSecretDirName(dir))) {
    return 'hidden';
  }
  if (isSecretFileName(fileName)) return 'secret';
  if (fileName.startsWith('.')) return 'hidden';
  if (AGENT_CONFIG_FILE_NAMES.has(fileName)) return 'agent_config';
  if (!knowledgeFileKind(fileName)) return 'not_text';
  return null;
}

/**
 * 保管庫のファイルの種類（チャンクの分け方）を決める。
 *
 * @param relativePath - 保管庫の中のパス
 * @returns 種類。取り込めない拡張子なら `null`
 */
export function vaultFileKind(relativePath: string): KnowledgeFileKind | null {
  return knowledgeFileKind(path.posix.basename(relativePath));
}

/**
 * 保管庫のファイルのドキュメントの名前（#235。`docs/28-rag.md` の C4）。
 *
 * 画面から上げたドキュメントの名前は `/` を含められないため、名前の一意制約のままでぶつからない。
 *
 * @param vault - 保管庫の名前
 * @param relativePath - 保管庫の中のパス
 * @returns `保管庫の名前/パス`
 */
export function vaultDocumentName(vault: string, relativePath: string): string {
  return `${vault}/${relativePath}`;
}

/** 保管庫の 1 つ（設定から決めたもの）。 */
export type VaultRoot = {
  /** 保管庫の名前（フォルダ名） */
  name: string;
  /** フォルダの実体のパス */
  root: string;
};

/**
 * 保管庫のフォルダに名前を付ける（#235。名前はフォルダ名）。
 *
 * 同じ名前のフォルダが 2 つ以上あれば、最初のものだけを使い、後のものを外す（DB の名前がぶつかるため）。
 *
 * @param roots - フォルダの実体のパス（設定の順）
 * @returns 使う保管庫と、名前が重なって外したフォルダ
 */
export function assignVaultNames(roots: string[]): {
  vaults: VaultRoot[];
  duplicates: string[];
} {
  const vaults: VaultRoot[] = [];
  const duplicates: string[] = [];
  for (const root of roots) {
    const name = path.basename(root);
    if (vaults.some((vault) => vault.name === name)) duplicates.push(root);
    else vaults.push({ name, root });
  }
  return { vaults, duplicates };
}

/** 保管庫の中で見つけた、取り込む候補のファイル（{@link planVaultSync} の入力）。 */
export type VaultFileEntry = {
  /** 保管庫の中のパス */
  path: string;
  /** 中身の版（git は blob の ID、フォルダは中身の SHA-256） */
  hash: string;
};

/** DB にある保管庫のドキュメント（{@link planVaultSync} の入力）。 */
export type VaultDocumentState = {
  /** ドキュメントの名前（`保管庫の名前/パス`） */
  name: string;
  /** 取り込んだ中身の版 */
  sourceHash: string | null;
  /** 埋め込みを作ったモデル */
  embeddingModel: string;
};

/**
 * 保管庫のファイルと DB のドキュメントを比べ、同期で行うことを決める（#235）。
 *
 * 各一覧はパスの符号の順に並べる（画面の進み具合の順を決まったものにする）。
 *
 * @param vault - 保管庫の名前
 * @param files - 保管庫の中の、取り込む候補のファイル
 * @param documents - DB にある、その保管庫のドキュメント
 * @param model - 今の埋め込みのモデル
 * @returns 差分
 */
export function planVaultSync(
  vault: string,
  files: VaultFileEntry[],
  documents: VaultDocumentState[],
  model: string
): VaultSyncPlan {
  const prefix = `${vault}/`;
  const existing = new Map(
    documents
      .filter((document) => document.name.startsWith(prefix))
      .map((document) => [document.name.slice(prefix.length), document])
  );
  const plan: VaultSyncPlan = {
    add: [],
    update: [],
    rebuild: [],
    remove: [],
    unchanged: 0,
  };
  const seen = new Set<string>();
  for (const file of files) {
    seen.add(file.path);
    const document = existing.get(file.path);
    if (!document) plan.add.push(file.path);
    else if (document.sourceHash !== file.hash) plan.update.push(file.path);
    else if (document.embeddingModel !== model) plan.rebuild.push(file.path);
    else plan.unchanged++;
  }
  for (const documentPath of existing.keys()) {
    if (!seen.has(documentPath)) plan.remove.push(documentPath);
  }
  const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  plan.add.sort(byCode);
  plan.update.sort(byCode);
  plan.rebuild.sort(byCode);
  plan.remove.sort(byCode);
  return plan;
}
