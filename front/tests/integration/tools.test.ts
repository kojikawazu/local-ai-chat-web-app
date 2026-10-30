import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

/**
 * `GET /api/tools` の IT（#148）。
 * `LOCAL_FILE_ROOTS` を設定していないときは、ローカルのファイルのツールを登録しない（既定では使わない）ことを確かめる。
 * `LOCAL_COMMANDS` があっても、作業フォルダにできる `LOCAL_FILE_WRITE_ROOTS` が無ければ `run_command` を登録しないことも確かめる（#148 Phase B）。
 * `GITHUB_REPOS` が無い・形が合わない値だけなら、GitHub のツールを登録しないことも確かめる（#148 Phase C）。
 * `BROWSER_ENABLED` が `true` でなければ、`BROWSER_LOCAL_ORIGINS` があってもブラウザのツールを登録しないことも確かめる（#149）。
 * 設定したときに出ることは chat-agent-local-files.test.ts で確かめる（registry は初めて使うときに環境変数を読むため、
 * 設定ごとにファイルを分けてモジュールを読み込み直す）。DB・Ollama は使わない。
 */
let GET: () => Promise<Response>;

beforeAll(async () => {
  // 開発者のシェルに LOCAL_FILE_ROOTS があっても結果が変わらないよう、空にしてから読み込む
  vi.stubEnv('LOCAL_FILE_ROOTS', '');
  vi.stubEnv('LOCAL_FILE_WRITE_ROOTS', '');
  vi.stubEnv('LOCAL_COMMANDS', 'node');
  // owner/name の形でない値だけなら、外して登録しない
  vi.stubEnv('GITHUB_REPOS', 'octo-org/*');
  // true 以外は使わない（手元のサーバーを書いても登録しない）
  vi.stubEnv('BROWSER_ENABLED', 'yes');
  vi.stubEnv('BROWSER_LOCAL_ORIGINS', 'http://localhost:5173');
  ({ GET } = await import('@/app/api/tools/route'));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

/**
 * ツールの一覧の名前を取り出す。
 *
 * @returns 登録されているツール名
 */
async function toolNames(): Promise<string[]> {
  const { tools } = await (await GET()).json();
  return tools.map((tool: { name: string }) => tool.name);
}

describe('GET /api/tools', () => {
  describe('正常系', () => {
    it('組み込みのツールを返す', async () => {
      expect(await toolNames()).toEqual(
        expect.arrayContaining([
          'get_current_datetime',
          'calculate',
          'web_search',
          'url_fetch',
        ])
      );
    });
  });

  describe('準正常系', () => {
    it('LOCAL_FILE_ROOTS・LOCAL_FILE_WRITE_ROOTS が無ければ、ローカルのファイルのツールは出ない', async () => {
      const names = await toolNames();
      for (const name of [
        'list_directory',
        'search_files',
        'read_file',
        'write_file',
        'edit_file',
      ]) {
        expect(names).not.toContain(name);
      }
    });

    it('LOCAL_COMMANDS があっても、LOCAL_FILE_WRITE_ROOTS が無ければ run_command は出ない', async () => {
      expect(await toolNames()).not.toContain('run_command');
    });

    it('GITHUB_REPOS に使える値が無ければ、GitHub のツールは出ない', async () => {
      const names = await toolNames();
      expect(names.filter((name) => name.startsWith('github_'))).toEqual([]);
    });

    it('BROWSER_ENABLED が true でなければ、ブラウザのツールは出ない', async () => {
      const names = await toolNames();
      expect(names.filter((name) => name.startsWith('browser_'))).toEqual([]);
    });
  });

  // 異常系: 引数を取らない GET で、入力起因の失敗経路が無い
});
