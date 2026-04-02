import { NextResponse } from 'next/server';
import { getAllToolDefinitions } from '@/lib/tools/index';
import { initializeTools } from '@/lib/tools/registry';

// ツールを登録（registry.ts で一元管理）
initializeTools();

export async function GET() {
  const definitions = getAllToolDefinitions();

  const tools = definitions.map((def) => ({
    name: def.function.name,
    description: def.function.description,
    enabled: true,
  }));

  return NextResponse.json({ tools });
}
