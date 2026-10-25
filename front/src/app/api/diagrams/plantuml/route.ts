import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { parsePlantUmlBody, readJsonBody } from '@/lib/server/request-body';
import { renderPlantUml } from '@/lib/server/plantuml';

/** 応答の前にクライアントが接続を切ったときのステータス（`/api/chat` と同じく nginx の慣習に揃える） */
const CLIENT_CLOSED_REQUEST = 499;

/**
 * PlantUML のソースを PlantUML サーバーで SVG にして返す（#171）。
 *
 * ブラウザから PlantUML サーバーへ直接つながず、ここを経由する。SVG はクライアントが data: URI の
 * `<img>` で表示する（DOM に入れない）。PlantUML サーバーへの接続は `lib/server/plantuml.ts` に委ねる。
 *
 * @param request - PlantUML のソース（`source`）を含む JSON ボディを持つリクエスト
 * @returns 成功時は `{ svg }`。JSON 構文不正・ボディが非オブジェクト・ソースが空／非文字列／上限超過、
 *   または PlantUML が描けなかった（構文の誤り等）ときは 400、PlantUML サーバーに繋がらない・時間切れは 502 の
 *   JSON エラーレスポンス。応答前に切断された場合は本文なしの 499
 */
export async function POST(request: NextRequest) {
  const raw = await readJsonBody(request);
  const parsed = raw.ok ? parsePlantUmlBody(raw.value) : raw;
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const result = await renderPlantUml(parsed.value.source, request.signal);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ svg: result.svg });
  } catch (error) {
    // renderPlantUml が投げるのは呼び出し元の中断だけ。去ったクライアントへエラーは返さない
    if (request.signal.aborted) {
      return new NextResponse(null, { status: CLIENT_CLOSED_REQUEST });
    }
    throw error;
  }
}
