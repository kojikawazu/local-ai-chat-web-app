import { realpathSync, statSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { isWithinRoot } from './path-guard';

/** {@link parseRootList} の結果。 */
type RootList = {
  /** 絶対パスにした候補（`~` をホームに置き換え、正規化済み。実在は確かめていない） */
  paths: string[];
  /** 絶対パスでないため外した値（警告に使う） */
  invalid: string[];
};

/**
 * `LOCAL_FILE_ROOTS` の値を、フォルダの絶対パスの一覧に分ける（#148。fs に触れない）。
 *
 * カンマで区切り、前後の空白と空の要素を捨てる。`~` か `~/` で始まる値はホームに置き換える。
 * 相対パスは「どこからの相対か」が起動の仕方で変わるため受け付けない。
 *
 * @param raw - 環境変数の値。未設定なら `undefined`
 * @param home - ホームのフォルダ（`~` の置き換え先）
 * @returns 候補のパスと、外した値
 */
export function parseRootList(raw: string | undefined, home: string): RootList {
  const paths: string[] = [];
  const invalid: string[] = [];
  for (const item of (raw ?? '').split(',')) {
    const value = item.trim();
    if (!value) continue;
    const expanded =
      value === '~' || value.startsWith('~/')
        ? path.join(home, value.slice(1))
        : value;
    if (path.isAbsolute(expanded)) paths.push(path.normalize(expanded));
    else invalid.push(value);
  }
  return { paths, invalid };
}

/**
 * 候補のフォルダを実体のパス（`realpath`）にし、使えないものを外す。
 *
 * 存在しない・フォルダでないものは `console.warn` で知らせて外す（設定ミスに気づけるように）。
 * 同じ実体を指すものは 1 つにまとめる。
 *
 * @param candidates - {@link parseRootList} の `paths`
 * @returns 許可するフォルダの実体のパス
 */
export function resolveRoots(candidates: string[]): string[] {
  const roots = new Set<string>();
  for (const candidate of candidates) {
    try {
      const real = realpathSync(candidate);
      if (!statSync(real).isDirectory()) {
        console.warn(
          `LOCAL_FILE_ROOTS の "${candidate}" はフォルダではないため使いません`
        );
        continue;
      }
      roots.add(real);
    } catch {
      console.warn(
        `LOCAL_FILE_ROOTS の "${candidate}" は見つからないため使いません`
      );
    }
  }
  return [...roots];
}

/** 起動後に 1 度だけ解釈した結果。`undefined` はまだ解釈していない */
let cachedRoots: string[] | undefined;

/**
 * ローカルのファイルのツールが読んでよいフォルダを、環境変数 `LOCAL_FILE_ROOTS` から解決する（#148）。
 *
 * 初めて呼んだときに 1 度だけ解釈する（変えたら開発サーバーを再起動する）。
 * 相対パスの値は `console.warn` で知らせて外す。`process.env.LOCAL_FILE_ROOTS` を読むのはこの関数だけ。
 *
 * @returns 許可するフォルダの実体のパス。未設定・全部外れたら空配列（ツールを使わない）
 */
export function getLocalFileRoots(): string[] {
  if (cachedRoots) return cachedRoots;
  const { paths, invalid } = parseRootList(
    process.env.LOCAL_FILE_ROOTS,
    homedir()
  );
  for (const value of invalid) {
    console.warn(
      `LOCAL_FILE_ROOTS の "${value}" は絶対パスではないため使いません`
    );
  }
  cachedRoots = resolveRoots(paths);
  return cachedRoots;
}

/** 起動後に 1 度だけ解釈した書き込みのフォルダ。`undefined` はまだ解釈していない */
let cachedWriteRoots: string[] | undefined;

/**
 * 書き込みのツールが書いてよいフォルダを、環境変数 `LOCAL_FILE_WRITE_ROOTS` から解決する（#148 Phase A2）。
 *
 * 書き方は `LOCAL_FILE_ROOTS` と同じ（カンマ区切りの絶対パス・`~` 可）。読み取りのフォルダ（{@link getLocalFileRoots}）の
 * 中に無いものは `console.warn` で知らせて外す（書く前に read_file で中身を確かめられるように）。
 * 初めて呼んだときに 1 度だけ解釈する。`process.env.LOCAL_FILE_WRITE_ROOTS` を読むのはこの関数だけ。
 *
 * @returns 書き込んでよいフォルダの実体のパス。未設定・全部外れたら空配列（書き込みのツールを使わない）
 */
export function getLocalFileWriteRoots(): string[] {
  if (cachedWriteRoots) return cachedWriteRoots;
  const { paths, invalid } = parseRootList(
    process.env.LOCAL_FILE_WRITE_ROOTS,
    homedir()
  );
  for (const value of invalid) {
    console.warn(
      `LOCAL_FILE_WRITE_ROOTS の "${value}" は絶対パスではないため使いません`
    );
  }
  const readRoots = getLocalFileRoots();
  cachedWriteRoots = resolveRoots(paths).filter((root) => {
    const readable = readRoots.some((readRoot) => isWithinRoot(root, readRoot));
    if (!readable) {
      console.warn(
        `LOCAL_FILE_WRITE_ROOTS の "${root}" は LOCAL_FILE_ROOTS の中に無いため使いません`
      );
    }
    return readable;
  });
  return cachedWriteRoots;
}
