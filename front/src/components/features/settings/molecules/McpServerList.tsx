import { Plug } from 'lucide-react';
import type { McpServerState, McpStatus } from '@/types/agent/mcp';
import { cn } from '@/lib/shared/class-names';

/** 状態の表示 */
const STATE_LABELS: Record<McpServerState, string> = {
  connected: '接続中',
  failed: '失敗',
  invalid: '設定の誤り',
};

/** 状態の色 */
const STATE_CLASSES: Record<McpServerState, string> = {
  connected: 'text-nord-aurora-green',
  failed: 'text-nord-aurora-red',
  invalid: 'text-nord-aurora-yellow',
};

/** {@link McpServerList} の props。 */
type McpServerListProps = {
  /** 接続の状態 */
  status: McpStatus;
};

/**
 * つないだ MCP のサーバーの状態の一覧（#208。`docs/31-mcp-client.md`「画面」）。
 *
 * 名前・状態・ツールの数・失敗の理由・上限で渡していないツールの数を出す。
 *
 * @param props - 接続の状態を持つ props
 */
export default function McpServerList({ status }: McpServerListProps) {
  return (
    <section aria-label="MCP サーバー" className="space-y-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-nord-6">
        <Plug size={16} className="text-nord-frost-1" />
        MCP Servers
      </p>
      {status.configError && (
        <p className="text-xs text-nord-aurora-red break-all">
          {status.configError}
        </p>
      )}
      <ul className="space-y-2">
        {status.servers.map((server) => (
          <li
            key={server.name}
            className="px-4 py-3 rounded-lg border bg-nord-2 border-nord-3"
          >
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm font-semibold text-nord-6 font-mono break-all">
                {server.name}
              </p>
              <p
                className={cn(
                  'shrink-0 text-xs font-semibold',
                  STATE_CLASSES[server.state]
                )}
              >
                {STATE_LABELS[server.state]}
              </p>
            </div>
            {server.state === 'connected' && (
              <p className="text-xs text-nord-4/60">
                ツール {server.toolCount} 個
                {server.omittedToolCount > 0 &&
                  `（ほかに ${server.omittedToolCount} 個は渡していません）`}
              </p>
            )}
            {server.error && (
              <p className="text-xs text-nord-4/60 break-all">{server.error}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
