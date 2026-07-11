import { prisma } from '@/lib/prisma';
import { NextRequest } from 'next/server';

export { prisma };

/**
 * DB を初期状態へ戻す。会話を全削除すると Message は `onDelete: Cascade` で連鎖削除される。
 * 各テストの `beforeEach` で呼び、テスト間の独立性を担保する。
 */
export async function resetDb(): Promise<void> {
  await prisma.conversation.deleteMany();
}

/**
 * route handler をブラウザ抜きで直接叩くための JSON リクエストを組み立てる。
 *
 * @param url - リクエスト URL（絶対 URL。パス解決には使われないがダミーで必須）
 * @param method - HTTP メソッド
 * @param body - JSON 化して送るボディ（省略時は本文なし）。`raw` に文字列を渡すと不正 JSON を再現できる
 * @returns 構築した NextRequest
 */
export function jsonRequest(
  url: string,
  method: string,
  body?: unknown,
): NextRequest {
  const init: { method: string; headers: Record<string, string>; body?: string } = {
    method,
    headers: { 'content-type': 'application/json' },
  };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  return new NextRequest(url, init);
}

/**
 * 動的ルート handler に渡すコンテキスト（`params` は Promise で解決される Next.js 仕様）。
 *
 * @param id - パスパラメータ `[id]` の値
 * @returns handler 第2引数のコンテキストオブジェクト
 */
export function routeContext(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}
