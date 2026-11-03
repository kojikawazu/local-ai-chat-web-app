import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { isValidVaultName } from '@/lib/knowledge/vault';
import { syncKnowledgeVaultFile } from '@/lib/server/knowledge-vault';
import { findKnowledgeVault } from '@/lib/server/knowledge-vault-config';
import { knowledgeErrorResponse } from '@/lib/server/knowledge-response';
import { parseVaultSyncBody, readJsonBody } from '@/lib/server/request-body';

/**
 * 保管庫の 1 ファイルを同期する（#235。`docs/28-rag.md`「保管庫の同期（Phase C）」の「流れ」）。
 *
 * サーバーがその場で取り込まない規則を当て直して読み、取り込む（`imported`）・何もしない（`unchanged`）・
 * 索引から消す（`removed`）のどれかを行う。同じパスを何度呼んでも結果は同じ。
 * 中身がテキストでない・空・チャンクが多すぎるファイルは、索引から消して `rejected` と理由を返す（そのファイルの同期の結果で、
 * API の失敗ではないため 200。画面は失敗のファイルとして残す）。
 *
 * @param request - `path`（保管庫の中の相対パス。`/` 区切り）を含む JSON ボディを持つリクエスト
 * @param context - ルートコンテキスト。`params` は保管庫の名前（`name`）を解決する Promise
 * @returns 成功時は `{ status, error? }` の JSON（`error` は `rejected` のときだけ）。名前・ボディの不正は 400、設定に無い保管庫は 404、
 *   埋め込みを作れなければ 502、保管庫を読めない・保存の失敗は 500 の JSON エラーレスポンス
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  if (!isValidVaultName(name)) {
    return NextResponse.json(
      { error: '無効な保管庫の名前です' },
      { status: 400 }
    );
  }
  const raw = await readJsonBody(request);
  const parsed = raw.ok ? parseVaultSyncBody(raw.value) : raw;
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const vault = findKnowledgeVault(name);
  if (!vault) {
    return NextResponse.json(
      { error: '保管庫が見つかりません' },
      { status: 404 }
    );
  }

  try {
    return NextResponse.json(
      await syncKnowledgeVaultFile(vault, parsed.value.path)
    );
  } catch (error) {
    return knowledgeErrorResponse(
      error,
      'sync knowledge vault file',
      '保管庫のファイルの保存に失敗しました'
    );
  }
}
