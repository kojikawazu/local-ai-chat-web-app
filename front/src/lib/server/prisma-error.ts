import { Prisma } from '@/generated/prisma/client';

/** 一意制約の違反の Prisma のエラーコード */
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Prisma の例外が一意制約の違反かを判定する（route が 409 を返すため）。
 *
 * 重複は事前の確認ではなく制約の違反で判定する。確認と作成の間に同じ値で作られても食い違わないため。
 * 使う場所: メッセージの主キー（クライアント採番の `id`。#9）、プロンプトテンプレートのショートカット（#28）。
 *
 * @param error - `create`・`update`・`$transaction` が投げた例外
 * @returns 一意制約の違反（`P2002`）なら true
 */
export function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_CONSTRAINT_VIOLATION
  );
}
