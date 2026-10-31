import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { buildBookmarkSnippet } from '@/lib/bookmark/snippet';
import { escapeLikePattern, parseSearchQuery } from '@/lib/conversation/search';
import {
  isForeignKeyConstraintError,
  isUniqueConstraintError,
} from '@/lib/server/prisma-error';
import {
  parseCreateBookmarkBody,
  readJsonBody,
} from '@/lib/server/request-body';
import type { BookmarkListItem } from '@/types/bookmark/bookmark';

// 一覧の 1 回で返す件数。会話の検索の結果と同じ
const BOOKMARK_PAGE_SIZE = 20;
const MESSAGE_NOT_FOUND_ERROR = 'メッセージが見つかりません';

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
 * ブックマークの一覧を、付けた日時の新しい順に返す（#30）。
 *
 * `q` を付けると、空白で区切った語のすべてを、メモ・応答の本文・会話のタイトルのどこかに含むものに絞る（AND）。
 * 解釈は会話の検索と同じ（大文字・小文字を区別しない部分一致。思考過程・ツールの結果は対象外）。
 * 各件には応答の抜粋を付ける（本文に語が現れればその前後、無ければ先頭）。
 *
 * @param request - クエリパラメータ `q`（キーワード。任意）と `offset`（開始位置。省略時 0）を持つリクエスト
 * @returns 成功時は `{ bookmarks, hasMore }`（最大 {@link BOOKMARK_PAGE_SIZE} 件と、続きの有無）。
 *   クエリの不正は 400、取得の失敗は 500 の JSON エラーレスポンス
 */
export async function GET(request: NextRequest) {
  const parsed = parseSearchQuery(request.nextUrl.searchParams, {
    allowEmpty: true,
  });
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { terms, offset } = parsed.value;

  try {
    const rows = await prisma.bookmark.findMany({
      where: {
        AND: terms.map((term) => ({
          OR: [
            { note: containsInsensitive(term) },
            { message: { content: containsInsensitive(term) } },
            {
              message: {
                conversation: { title: containsInsensitive(term) },
              },
            },
          ],
        })),
      },
      // 同じ日時でもページの境目で重複・抜けを出さないため、id でも並べる
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: offset,
      take: BOOKMARK_PAGE_SIZE + 1,
      select: {
        id: true,
        note: true,
        createdAt: true,
        message: {
          select: {
            id: true,
            content: true,
            conversation: { select: { id: true, title: true } },
          },
        },
      },
    });

    const bookmarks: BookmarkListItem[] = rows
      .slice(0, BOOKMARK_PAGE_SIZE)
      .map(({ id, note, createdAt, message }) => ({
        id,
        note,
        createdAt: createdAt.toISOString(),
        messageId: message.id,
        conversationId: message.conversation.id,
        conversationTitle: message.conversation.title,
        snippet: buildBookmarkSnippet(message.content, terms),
      }));

    return NextResponse.json({
      bookmarks,
      hasMore: rows.length > BOOKMARK_PAGE_SIZE,
    });
  } catch (error) {
    console.error('Failed to fetch bookmarks:', error);
    return NextResponse.json(
      { error: 'ブックマークの取得に失敗しました' },
      { status: 500 }
    );
  }
}

/**
 * 応答（assistant のメッセージ）にブックマークを付ける（#30）。メモは付けない（一覧で後から書く）。
 *
 * user のメッセージは 400。もう付いていれば、事前に確かめず一意制約の違反（`P2002`）で 409 を返す。
 * メッセージを読んでから作る間に消された場合は、外部キーの違反（`P2003`）を 404 にする。
 *
 * @param request - `messageId`（UUID）を含む JSON ボディを持つリクエスト（{@link parseCreateBookmarkBody}）
 * @returns 成功時は作ったブックマークの JSON（ステータス 201）。ボディの不正・user のメッセージは 400、
 *   メッセージが無ければ 404、もう付いていれば 409、作成の失敗は 500 の JSON エラーレスポンス
 */
export async function POST(request: NextRequest) {
  const raw = await readJsonBody(request);
  const parsed = raw.ok ? parseCreateBookmarkBody(raw.value) : raw;
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { messageId } = parsed.value;

  try {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { role: true },
    });
    if (!message) {
      return NextResponse.json(
        { error: MESSAGE_NOT_FOUND_ERROR },
        { status: 404 }
      );
    }
    if (message.role !== 'assistant') {
      return NextResponse.json(
        { error: 'ブックマークできるのは応答だけです' },
        { status: 400 }
      );
    }

    const bookmark = await prisma.bookmark.create({ data: { messageId } });
    return NextResponse.json(bookmark, { status: 201 });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return NextResponse.json(
        { error: 'この応答はもうブックマークしています' },
        { status: 409 }
      );
    }
    if (isForeignKeyConstraintError(error)) {
      return NextResponse.json(
        { error: MESSAGE_NOT_FOUND_ERROR },
        { status: 404 }
      );
    }
    console.error('Failed to create bookmark:', error);
    return NextResponse.json(
      { error: 'ブックマークに失敗しました' },
      { status: 500 }
    );
  }
}
