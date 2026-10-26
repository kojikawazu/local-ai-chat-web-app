import { NextResponse } from 'next/server';
import { listModels, getDefaultModel, supportsVision } from '@/lib/llm/ollama';

/**
 * Ollama で利用可能なモデル一覧と既定モデル名を取得する。
 *
 * 画像を添付できるかを画面で案内するため、画像に対応したモデルの一覧（`visionModels`）も返す（#6）。
 * 対応機能はモデルごとに並列に問い合わせ、問い合わせに失敗したモデルは `visionModels` から外すだけにする
 * （一覧の取得自体は失敗させない）。
 *
 * @returns 成功時はモデル名配列・画像に対応したモデル名配列・既定モデルを含む JSON（`{ models, visionModels, defaultModel }`）。Ollama への接続失敗は 502 の JSON エラーレスポンス
 */
export async function GET() {
  try {
    const names = (await listModels()).map((m) => m.name);
    const vision = await Promise.allSettled(names.map(supportsVision));
    return NextResponse.json({
      models: names,
      visionModels: names.filter((_, index) => {
        const result = vision[index];
        return result.status === 'fulfilled' && result.value;
      }),
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
