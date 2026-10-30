/**
 * ツール登録の初期化モジュール。
 * ここで全ツールを一度だけ登録する。
 * /api/chat と /api/tools の両方からこのモジュールを import することで
 * 重複登録を防ぐ（Map.set は冪等だが、管理ポイントを1箇所に集約する）。
 */
import { registerTool } from './index';
import { getCurrentDatetimeTool } from './get-current-datetime';
import { calculateTool } from './calculate';
import { webSearchTool } from './web-search';
import { urlFetchTool } from './url-fetch';
import {
  getLocalFileRoots,
  getLocalFileWriteRoots,
} from './local-files/config';
import { createListDirectoryTool } from './local-files/list-directory';
import { createSearchFilesTool } from './local-files/search-files';
import { createReadFileTool } from './local-files/read-file';
import { createWriteFileTool } from './local-files/write-file';
import { createEditFileTool } from './local-files/edit-file';
import { getCommandTimeoutMs, getLocalCommands } from './local-commands/config';
import { createRunCommandTool } from './local-commands/run-command';
import { getGitHubRepos } from './github/config';
import { createGitHubListTool } from './github/list';
import { createGitHubViewTool } from './github/view';
import { createGitHubPrDiffTool } from './github/pr-diff';
import { createGitHubCommentTool } from './github/comment';
import { createGitHubCreatePrTool } from './github/create-pr';
import { getBrowserLocalOrigins, isBrowserEnabled } from './browser/config';
import { createBrowserNavigateTool } from './browser/navigate';
import { createBrowserSnapshotTool } from './browser/read-snapshot';
import { createBrowserScreenshotTool } from './browser/screenshot';
import { createBrowserClickTool } from './browser/click';
import { createBrowserTypeTool } from './browser/type';
import { createBrowserSelectTool } from './browser/select';

let initialized = false;

/**
 * 全ツールをレジストリへ一度だけ登録する。
 *
 * ローカルのファイルのツール（`list_directory`・`search_files`・`read_file`。#148）は、
 * 読んでよいフォルダ（`LOCAL_FILE_ROOTS`）が 1 つ以上あるときだけ登録する（既定では使わない）。
 * 書き込みのツール（`write_file`・`edit_file`。実行前に承認が要る。#148 Phase A2）は、書き込んでよいフォルダ
 * （`LOCAL_FILE_WRITE_ROOTS`。読み取りのフォルダの中だけ）が 1 つ以上あるときだけ登録する。
 * コマンドの実行（`run_command`。実行前に承認が要る。#148 Phase B）は、実行してよいプログラム（`LOCAL_COMMANDS`）と
 * 書き込みのフォルダ（作業フォルダにしてよい範囲）の両方があるときだけ登録する。
 * GitHub のツール（読む `github_list`・`github_view`・`github_pr_diff` と、承認が要る `github_comment`・`github_create_pr`。
 * #148 Phase C）は、扱ってよいリポジトリ（`GITHUB_REPOS`）が 1 つ以上あるときだけ登録する。
 * ブラウザのツール（読み取りの `browser_navigate`・`browser_snapshot`・`browser_screenshot`。#149。操作の `browser_click`・`browser_type`・`browser_select`。#149 Phase C）は、`BROWSER_ENABLED=true` のときだけ登録する。
 * 手元の開発サーバーは `BROWSER_LOCAL_ORIGINS` に書いたものだけを開ける（無ければ公開の Web だけ）。
 * 2 回目以降の呼び出しは何もしない（`initialized` フラグで冪等性を保証）。
 * `/api/chat` と `/api/tools` の両方から呼ばれても登録は 1 回だけ行われる。
 */
export function initializeTools(): void {
  if (initialized) return;
  initialized = true;
  registerTool(getCurrentDatetimeTool);
  registerTool(calculateTool);
  registerTool(webSearchTool);
  registerTool(urlFetchTool);

  const roots = getLocalFileRoots();
  if (roots.length > 0) {
    registerTool(createListDirectoryTool(roots));
    registerTool(createSearchFilesTool(roots));
    registerTool(createReadFileTool(roots));
  }

  const writeRoots = getLocalFileWriteRoots();
  if (writeRoots.length > 0) {
    registerTool(createWriteFileTool(writeRoots));
    registerTool(createEditFileTool(writeRoots));
  }

  const programs = getLocalCommands();
  if (programs.length > 0) {
    if (writeRoots.length > 0) {
      registerTool(
        createRunCommandTool({
          programs,
          roots: writeRoots,
          timeoutMs: getCommandTimeoutMs(),
        })
      );
    } else {
      console.warn(
        'LOCAL_COMMANDS がありますが、作業フォルダにできる LOCAL_FILE_WRITE_ROOTS が無いため run_command を使いません'
      );
    }
  }

  const repos = getGitHubRepos();
  if (repos.length > 0) {
    registerTool(createGitHubListTool(repos));
    registerTool(createGitHubViewTool(repos));
    registerTool(createGitHubPrDiffTool(repos));
    registerTool(createGitHubCommentTool(repos));
    registerTool(createGitHubCreatePrTool(repos));
  }

  if (isBrowserEnabled()) {
    const localOrigins = getBrowserLocalOrigins();
    registerTool(createBrowserNavigateTool(localOrigins));
    registerTool(createBrowserSnapshotTool());
    registerTool(createBrowserScreenshotTool());
    registerTool(createBrowserClickTool(localOrigins));
    registerTool(createBrowserTypeTool(localOrigins));
    registerTool(createBrowserSelectTool(localOrigins));
  }
}
