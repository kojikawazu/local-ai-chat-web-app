import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { resolveApproval } from '@/lib/agent/approvals';
import { parseApprovalBody, readJsonBody } from '@/lib/server/request-body';
import { isValidUUID } from '@/lib/shared/validation';

/**
 * ツールの実行前の承認に、許可か拒否かを渡す（#148 Phase A2。`docs/15-tool-approval.md`）。
 *
 * エージェントループが `tool_approval_request` で送った承認 ID を受け、待っている承認を決着させる。
 * 待っている承認が無い（知らない ID・決着済み・時間切れ・停止済み）なら 404。
 *
 * @param request - `approved`（真偽値）を含む JSON ボディを持つリクエスト
 * @param context - ルートコンテキスト。`params` は承認 ID（UUID）を解決する Promise
 * @returns 決着させたら 204。ID・ボディの不正は 400、待っている承認が無ければ 404 の JSON エラーレスポンス
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ error: '無効な承認IDです' }, { status: 400 });
  }

  const raw = await readJsonBody(request);
  const parsed = raw.ok ? parseApprovalBody(raw.value) : raw;
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  if (!resolveApproval(id, parsed.value.approved)) {
    return NextResponse.json(
      {
        error:
          '承認を待っているツールがありません（決着済み・時間切れ・停止済み）',
      },
      { status: 404 }
    );
  }
  return new Response(null, { status: 204 });
}
