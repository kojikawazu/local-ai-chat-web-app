/** リポジトリの持ち主の名前。英数字とハイフンで 39 文字まで、ハイフンで始まらない（GitHub のユーザー名・組織名の規則） */
const OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;

/** リポジトリの名前。英数字と `.` `_` `-` で 100 文字まで（GitHub のリポジトリ名の規則） */
const NAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

/** {@link parseRepoList} の結果。 */
type RepoList = {
  /** 扱ってよいリポジトリ（`owner/name`。書かれた綴りのまま） */
  repos: string[];
  /** 形が合わないため外した値 */
  invalid: string[];
};

/**
 * 値が `owner/name` の形のリポジトリ名かを判定する（#148 Phase C）。
 *
 * @param value - 判定する値
 * @returns `owner/name` の形なら true
 */
export function isRepoName(value: string): boolean {
  const parts = value.split('/');
  if (parts.length !== 2) return false;
  const [owner, name] = parts;
  return (
    OWNER_PATTERN.test(owner) &&
    NAME_PATTERN.test(name) &&
    name !== '.' &&
    name !== '..'
  );
}

/**
 * `GITHUB_REPOS` の値を、扱ってよいリポジトリの一覧に分ける（#148 Phase C。`docs/17-github-tools.md`）。
 *
 * カンマで区切り、前後の空白と空の要素を捨てる。GitHub はリポジトリ名の大文字・小文字を区別しないため、
 * 大文字・小文字だけが違うものは最初の綴りにまとめる。`owner/*` のようなまとめての指定も含め、形が合わない値は外す。
 *
 * @param raw - 環境変数の値。未設定なら `undefined`
 * @returns 扱ってよいリポジトリと、外した値
 */
export function parseRepoList(raw: string | undefined): RepoList {
  const repos = new Map<string, string>();
  const invalid: string[] = [];
  for (const item of (raw ?? '').split(',')) {
    const repo = item.trim();
    if (!repo) continue;
    if (!isRepoName(repo)) invalid.push(repo);
    else if (!repos.has(repo.toLowerCase())) {
      repos.set(repo.toLowerCase(), repo);
    }
  }
  return { repos: [...repos.values()], invalid };
}

/** 起動後に 1 度だけ解釈した結果。`undefined` はまだ解釈していない */
let cachedRepos: string[] | undefined;

/**
 * エージェントが GitHub のツールで扱ってよいリポジトリを、環境変数 `GITHUB_REPOS` から解決する（#148 Phase C）。
 *
 * 初めて呼んだときに 1 度だけ解釈する（変えたら開発サーバーを再起動する）。外した値は `console.warn` で知らせる。
 * `process.env.GITHUB_REPOS` を読むのはこの関数だけ。
 *
 * @returns 扱ってよいリポジトリ（`owner/name`）。未設定・全部外れたら空配列（ツールを使わない）
 */
export function getGitHubRepos(): string[] {
  if (cachedRepos) return cachedRepos;
  const { repos, invalid } = parseRepoList(process.env.GITHUB_REPOS);
  for (const value of invalid) {
    console.warn(
      `GITHUB_REPOS の "${value}" は owner/name の形ではないため使いません`
    );
  }
  cachedRepos = repos;
  return cachedRepos;
}
