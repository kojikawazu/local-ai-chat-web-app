import { NextResponse } from 'next/server';
import { getAllToolDefinitions } from '@/lib/tools/index';
import { initializeTools } from '@/lib/tools/registry';

// ツールを登録（registry.ts で一元管理）
initializeTools();

/**
 * エージェントが利用可能なツールの一覧を取得する。
 *
 * 登録済みツール定義から名前・説明を抽出し、有効フラグ付きで返す。
 *
 * @returns ツール情報の配列を含む JSON（`{ tools }`。各要素は `name` / `description` / `enabled`）
 */
export async function GET() {
  const definitions = getAllToolDefinitions();

  const tools = definitions.map((def) => ({
    name: def.function.name,
    description: def.function.description,
    enabled: true,
  }));

  return NextResponse.json({ tools });
}
