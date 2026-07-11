import { NextResponse } from 'next/server';
import { listModels, getDefaultModel } from '@/lib/ollama';

/**
 * Ollama で利用可能なモデル一覧と既定モデル名を取得する。
 *
 * @returns 成功時はモデル名配列と既定モデルを含む JSON（`{ models, defaultModel }`）。Ollama への接続失敗は 502 の JSON エラーレスポンス
 */
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
