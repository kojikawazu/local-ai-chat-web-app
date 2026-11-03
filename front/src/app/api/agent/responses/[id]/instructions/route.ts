import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { addInstruction } from '@/lib/agent/instructions';
import { parseInstructionBody, readJsonBody } from '@/lib/server/request-body';
import {
  isValidUUID,
  MAX_INSTRUCTIONS_PER_RESPONSE,
} from '@/lib/shared/validation';

/**
 * エージェントの応答の途中に、利用者の追加の指示を入れる（割り込み。#241。`docs/30-agent-interrupt.md`）。
 *
 * `/api/chat` のストリームの最初の `response_started` で受け取った応答の ID の受け箱に入れる。エージェントは次の区切り
 * （次の問い合わせの前）で読み、`instruction_applied` を送る。
 *
 * @param request - `content`（1〜2,000 文字）を含む JSON ボディを持つリクエスト
 * @param context - パスパラメータ（`id`: 応答の ID）
 * @returns 受け付けたら 202 と `{ instructionId }`。ID の形・ボディの不正は 400、待っている応答が無い（終わった・知らない）は 404、
 *   1 回の応答の上限を超えたら 409
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ error: '無効な応答IDです' }, { status: 400 });
  }

  const raw = await readJsonBody(request);
  const parsed = raw.ok ? parseInstructionBody(raw.value) : raw;
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const added = addInstruction(id, parsed.value.content);
  if (!added.ok) {
    return added.reason === 'not_found'
      ? NextResponse.json(
          {
            error: '指示を待っている応答がありません（終わった・停止した応答）',
          },
          { status: 404 }
        )
      : NextResponse.json(
          {
            error: `1 回の応答で送れる指示は${MAX_INSTRUCTIONS_PER_RESPONSE}件までです`,
          },
          { status: 409 }
        );
  }
  return NextResponse.json({ instructionId: added.id }, { status: 202 });
}
