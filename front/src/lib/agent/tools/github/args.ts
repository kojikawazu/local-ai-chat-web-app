import type { GitHubItemKind, GitHubListState } from '@/types/agent/tool-call';
import { GITHUB_LIST_STATES } from '@/types/agent/tool-call';
import { MAX_LIST_LIMIT } from '@/constants/agent/github';
import type { ToolDefinition } from '../types';

/** 一覧の件数の既定 */
const DEFAULT_LIST_LIMIT = 10;

/** ブランチ名の長さの上限（Git の参照名の実用上の上限） */
const MAX_BRANCH_LENGTH = 255;

/** 差分を絞るファイルのパスの長さの上限 */
const MAX_FILE_PATH_LENGTH = 1_000;

/** 番号として受け付ける最大値（GitHub の番号は 32 bit の整数に収まる） */
const MAX_ITEM_NUMBER = 2_147_483_647;

// ブランチ名に使える文字（Git の参照名の規則のうち、よく使う範囲だけ）
const BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/;

/** 引数の検証の結果。合わなければモデルへ返す理由を持つ */
type ArgResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * 検証の失敗を作る。
 *
 * @param reason - モデルへ返す理由
 * @returns 失敗の結果
 */
function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

/**
 * リポジトリを、扱ってよいリポジトリ（`GITHUB_REPOS`）のどれかに決める（#148 Phase C）。
 *
 * 大文字・小文字は区別せずに照らし、許可リストに書かれた綴りを返す（`gh` には検証済みの値だけを渡す）。
 *
 * @param value - モデルが渡した値
 * @param repos - 扱ってよいリポジトリ
 * @returns 許可リストの綴りのリポジトリ。外れたら理由
 */
export function parseRepo(value: unknown, repos: string[]): ArgResult<string> {
  const list = repos.join(', ');
  if (typeof value !== 'string' || value.trim() === '') {
    return fail(
      `repo にリポジトリを指定してください。使えるリポジトリ: ${list}`
    );
  }
  const wanted = value.trim().toLowerCase();
  const found = repos.find((repo) => repo.toLowerCase() === wanted);
  return found
    ? { ok: true, value: found }
    : fail(
        `「${value.trim()}」は扱うことが許可されていません。使えるリポジトリ: ${list}`
      );
}

/**
 * 種類（PR か issue か）を確かめる。
 *
 * @param value - モデルが渡した値
 * @returns 種類。合わなければ理由
 */
export function parseKind(value: unknown): ArgResult<GitHubItemKind> {
  return value === 'pr' || value === 'issue'
    ? { ok: true, value }
    : fail('kind は "pr" か "issue" を指定してください');
}

/**
 * 番号を確かめる。小さいモデルは数を文字列で渡しがちなため、`"193"`・`"#193"` も受け付ける。
 *
 * @param value - モデルが渡した値
 * @returns 1 以上の整数。合わなければ理由
 */
export function parseItemNumber(value: unknown): ArgResult<number> {
  const text =
    typeof value === 'number'
      ? String(value)
      : typeof value === 'string'
        ? value.trim().replace(/^#/, '')
        : '';
  const number = /^\d+$/.test(text) ? Number(text) : NaN;
  return Number.isSafeInteger(number) &&
    number >= 1 &&
    number <= MAX_ITEM_NUMBER
    ? { ok: true, value: number }
    : fail('number には PR・issue の番号（1 以上の整数）を指定してください');
}

/**
 * 一覧の状態を確かめる。省略時は `open`。`merged` は PR だけで使える。
 *
 * @param value - モデルが渡した値
 * @param kind - 一覧にする種類
 * @returns 状態。合わなければ理由
 */
export function parseListState(
  value: unknown,
  kind: GitHubItemKind
): ArgResult<GitHubListState> {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: 'open' };
  }
  const state = GITHUB_LIST_STATES.find((candidate) => candidate === value);
  if (!state) {
    return fail(
      `state は ${GITHUB_LIST_STATES.join('・')} のどれかを指定してください`
    );
  }
  if (state === 'merged' && kind !== 'pr') {
    return fail('state の merged は PR の一覧でだけ使えます');
  }
  return { ok: true, value: state };
}

/**
 * 一覧の件数を確かめる。省略時は {@link DEFAULT_LIST_LIMIT}、範囲の外は 1〜{@link MAX_LIST_LIMIT} に丸める。
 *
 * @param value - モデルが渡した値
 * @returns 件数。数でなければ理由
 */
export function parseListLimit(value: unknown): ArgResult<number> {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: DEFAULT_LIST_LIMIT };
  }
  const number = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof number !== 'number' || !Number.isFinite(number)) {
    return fail(`limit には件数（1〜${MAX_LIST_LIMIT}）を指定してください`);
  }
  return {
    ok: true,
    value: Math.min(Math.max(Math.trunc(number), 1), MAX_LIST_LIMIT),
  };
}

/**
 * ブランチ名を確かめる。`gh` のフラグに見える値（`-` で始まる）や、Git の参照名に使えない形を通さない。
 *
 * @param value - モデルが渡した値
 * @param label - 引数の名前（理由に入れる）
 * @returns 前後の空白を除いたブランチ名。合わなければ理由
 */
export function parseBranch(value: unknown, label: string): ArgResult<string> {
  if (typeof value !== 'string' || value.trim() === '') {
    return fail(`${label} にブランチ名を指定してください`);
  }
  const branch = value.trim();
  const valid =
    branch.length <= MAX_BRANCH_LENGTH &&
    BRANCH_PATTERN.test(branch) &&
    !branch.startsWith('-') &&
    !branch.startsWith('/') &&
    !branch.endsWith('/') &&
    !branch.includes('..') &&
    !branch.includes('//');
  return valid
    ? { ok: true, value: branch }
    : fail(
        `${label} の「${branch}」はブランチ名として使えません（英数字と . _ - / だけ。- や / で始まらない・.. を含まない）`
      );
}

/**
 * 文章の引数（タイトル・本文）を確かめる。
 *
 * @param value - モデルが渡した値
 * @param label - 引数の名前（理由に入れる）
 * @param maxLength - 長さの上限（文字数）
 * @param singleLine - true なら改行を空白にする（タイトル）
 * @returns 文章。空・長すぎれば理由
 */
export function parseText(
  value: unknown,
  label: string,
  maxLength: number,
  singleLine = false
): ArgResult<string> {
  if (typeof value !== 'string' || value.trim() === '') {
    return fail(`${label} を指定してください`);
  }
  const text = singleLine
    ? value.replace(/\s*[\r\n]+\s*/g, ' ').trim()
    : value.trim();
  return text.length <= maxLength
    ? { ok: true, value: text }
    : fail(
        `${label} が長すぎます（${text.length.toLocaleString()} 文字。${maxLength.toLocaleString()} 文字まで）`
      );
}

/**
 * 差分を絞るファイルのパスを確かめる。省略できる。`gh` には渡さず、アプリの中で差分を絞るのに使う。
 *
 * @param value - モデルが渡した値
 * @returns ファイルのパス（省略時は `undefined`）。合わなければ理由
 */
export function parseDiffFile(value: unknown): ArgResult<string | undefined> {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: undefined };
  }
  if (typeof value !== 'string' || value.length > MAX_FILE_PATH_LENGTH) {
    return fail('file には差分を見たいファイルのパスを指定してください');
  }
  return { ok: true, value: value.trim().replace(/^\.\//, '') };
}

/**
 * 真偽の引数（下書きか）を確かめる。小さいモデルが文字列で渡す `"true"`・`"false"` も受け付ける。
 *
 * @param value - モデルが渡した値
 * @returns 真偽（省略時は false）
 */
export function parseFlag(value: unknown): boolean {
  return value === true || value === 'true';
}

/** ツールの引数 1 つの定義（`ToolDefinition` の `properties` の値） */
type ParamSchema = ToolDefinition['parameters']['properties'][string];

/**
 * `repo` の引数の定義。扱ってよいリポジトリを列挙値にして、モデルに書き間違えさせない。
 *
 * @param repos - 扱ってよいリポジトリ
 * @returns 引数の定義
 */
export function repoParam(repos: string[]): ParamSchema {
  return {
    type: 'string',
    description: `リポジトリ（owner/name）。次のどれか: ${repos.join(', ')}`,
    enum: repos,
  };
}
