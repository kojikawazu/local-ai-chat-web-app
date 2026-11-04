'use client';

import { useEffect, useState } from 'react';
import type { McpStatus } from '@/types/agent/mcp';

const TOOLS_URL = '/api/tools';

/**
 * つないだ MCP のサーバーの状態を読むフック（#208。設定の画面に出す）。
 *
 * 開くたびに読み直す（`/api/tools` が接続し直すため、切れたサーバーの今の状態が分かる）。
 * 読めなかったときは前の値のままにする（最初は `null` で、何も出さない）。
 *
 * @param enabled - 読むか（設定の画面が開いている間だけ true）
 * @returns 接続の状態。読めていなければ `null`
 */
export function useMcpServers(enabled: boolean): McpStatus | null {
  const [status, setStatus] = useState<McpStatus | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(TOOLS_URL);
        if (!res.ok || cancelled) return;
        const body: { mcp?: McpStatus } = await res.json();
        if (!cancelled && body.mcp) setStatus(body.mcp);
      } catch (error) {
        console.error('Failed to fetch MCP servers:', error);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return status;
}
