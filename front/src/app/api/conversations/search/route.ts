import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import {
  buildSnippet,
  escapeLikePattern,
  parseSearchQuery,
} from '@/lib/conversation/search';
import type { ConversationSearchResult } from '@/types/conversation/conversation';

// 1 回に返す件数。サイドバーに並べて見渡せる量にし、続きは「さらに表示」で取る
const SEARCH_PAGE_SIZE = 20;

/**
 * 大文字・小文字を区別しない部分一致の条件を作る。`%`・`_` は文字そのものとして扱う。
 *
 * @param term - キーワード
 * @returns Prisma の文字列の絞り込み条件
 */
function containsInsensitive(term: string) {
  return { contains: escapeLikePattern(term), mode: 'insensitive' as const };
}

/**
 * 会話をキーワードで検索する（#11）。
 *
 * 空白で区切った語のすべてを、会話のタイトルかメッセージの本文（質問・応答）のどこかに含む
 * 会話を、更新日時の新しい順に返す（AND）。思考過程・ツールの結果（`metadata`）は対象外。
 * 一致は大文字・小文字を区別しない部分一致（PostgreSQL の `ILIKE`）。
 * 各会話には、最初にキーワードが現れたメッセージの抜粋を付ける。
 *
 * @param request - クエリパラメータ `q`（キーワード。必須）と `offset`（開始位置。省略時 0）を持つリクエスト
 * @returns 成功時は `{ results, hasMore }`（最大 {@link SEARCH_PAGE_SIZE} 件と、続きの有無）。
 *   クエリの不正は 400、検索の失敗は 500 の JSON エラーレスポンス
 */
export async function GET(request: NextRequest) {
  const parsed = parseSearchQuery(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { terms, offset } = parsed.value;

  try {
    const rows = await prisma.conversation.findMany({
      where: {
        AND: terms.map((term) => ({
          OR: [
            { title: containsInsensitive(term) },
            { messages: { some: { content: containsInsensitive(term) } } },
          ],
        })),
      },
      // 同じ更新日時の会話でもページの境目で順序が揺れないよう、id で並びを確定させる
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      skip: offset,
      // 続きの有無を知るため 1 件多く取る
      take: SEARCH_PAGE_SIZE + 1,
      select: {
        id: true,
        title: true,
        updatedAt: true,
        // 抜粋に使う、キーワードのいずれかを含む最初のメッセージ
        messages: {
          where: {
            OR: terms.map((term) => ({ content: containsInsensitive(term) })),
          },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { content: true },
        },
      },
    });

    const results: ConversationSearchResult[] = rows
      .slice(0, SEARCH_PAGE_SIZE)
      .map(({ messages, updatedAt, ...conversation }) => ({
        ...conversation,
        updatedAt: updatedAt.toISOString(),
        snippet: messages[0] ? buildSnippet(messages[0].content, terms) : null,
      }));

    return NextResponse.json({
      results,
      hasMore: rows.length > SEARCH_PAGE_SIZE,
    });
  } catch (error) {
    console.error('Failed to search conversations:', error);
    return NextResponse.json(
      { error: '会話の検索に失敗しました' },
      { status: 500 }
    );
  }
}
