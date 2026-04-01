import { NextResponse } from 'next/server';
import { getAllToolDefinitions, registerTool } from '@/lib/tools/index';
import { getCurrentDatetimeTool } from '@/lib/tools/get-current-datetime';
import { calculateTool } from '@/lib/tools/calculate';

// ツールを登録（モジュール初回ロード時に1度だけ実行）
registerTool(getCurrentDatetimeTool);
registerTool(calculateTool);

export async function GET() {
  const definitions = getAllToolDefinitions();

  const tools = definitions.map((def) => ({
    name: def.function.name,
    description: def.function.description,
    enabled: true,
  }));

  return NextResponse.json({ tools });
}
