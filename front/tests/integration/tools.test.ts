import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

/**
 * `GET /api/tools` の IT（#148）。
 * `LOCAL_FILE_ROOTS` を設定していないときは、ローカルのファイルのツールを登録しない（既定では使わない）ことを確かめる。
 * 設定したときに出ることは chat-agent-local-files.test.ts で確かめる（registry は初めて使うときに環境変数を読むため、
 * 設定ごとにファイルを分けてモジュールを読み込み直す）。DB・Ollama は使わない。
 */
let GET: () => Promise<Response>;

beforeAll(async () => {
  // 開発者のシェルに LOCAL_FILE_ROOTS があっても結果が変わらないよう、空にしてから読み込む
  vi.stubEnv('LOCAL_FILE_ROOTS', '');
  vi.stubEnv('LOCAL_FILE_WRITE_ROOTS', '');
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
  });

  // 異常系: 引数を取らない GET で、入力起因の失敗経路が無い
});
