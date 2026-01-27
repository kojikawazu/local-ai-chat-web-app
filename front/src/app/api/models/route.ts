import { NextResponse } from 'next/server';
import { listModels, getDefaultModel } from '@/lib/ollama';

export async function GET() {
  try {
    const models = await listModels();
    return NextResponse.json({
      models: models.map((m) => m.name),
      defaultModel: getDefaultModel(),
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to fetch models:', errorMessage);
    return NextResponse.json(
      { error: `モデル一覧の取得に失敗しました: ${errorMessage}` },
      { status: 502 }
    );
  }
}
