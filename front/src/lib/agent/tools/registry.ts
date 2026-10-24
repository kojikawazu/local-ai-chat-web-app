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

let initialized = false;

/**
 * 全ツールをレジストリへ一度だけ登録する。
 *
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
}
