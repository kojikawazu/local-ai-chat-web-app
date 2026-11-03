import { homedir } from 'node:os';
import path from 'node:path';
import { Prisma } from '@/generated/prisma/client';
import {
  parseRootList,
  resolveRoots,
} from '@/lib/agent/tools/local-files/config';
import { assignVaultNames } from '@/lib/knowledge/vault';
import type { VaultRoot } from '@/lib/knowledge/vault';

/**
 * RAG の保管庫（#235）の設定（`KNOWLEDGE_VAULTS`）と、検索で比べる範囲。
 *
 * 取り込み・検索（`lib/server/knowledge.ts`）と同期（`lib/server/knowledge-vault.ts`）の両方から使うため、
 * 互いを読み込まないよう別のファイルにする。
 */

/** 保管庫の最大数（設定の誤りで大量のフォルダを読ませないため） */
const MAX_KNOWLEDGE_VAULTS = 10;

/** 起動後に 1 度だけ解釈した保管庫。`undefined` はまだ解釈していない */
let cachedVaults: VaultRoot[] | undefined;

/**
 * 保管庫を環境変数 `KNOWLEDGE_VAULTS` から解決する（#235。`docs/28-rag.md` の C1）。
 *
 * 書き方は `LOCAL_FILE_ROOTS` と同じ（カンマ区切りの絶対パス・`~` 可）。名前はフォルダ名で、名前が重なるもの・
 * {@link MAX_KNOWLEDGE_VAULTS} を超えるものは `console.warn` で知らせて外す。初めて呼んだときに 1 度だけ解釈する
 * （変えたら開発サーバーを再起動する）。`process.env.KNOWLEDGE_VAULTS` を読むのはこの関数だけ。
 *
 * @returns 保管庫（設定の順）。未設定なら空配列
 */
export function getKnowledgeVaults(): VaultRoot[] {
  if (cachedVaults) return cachedVaults;
  const { paths, invalid } = parseRootList(
    process.env.KNOWLEDGE_VAULTS,
    homedir()
  );
  for (const value of invalid) {
    console.warn(
      `KNOWLEDGE_VAULTS の "${value}" は絶対パスではないため使いません`
    );
  }
  const { vaults, duplicates } = assignVaultNames(
    resolveRoots(paths, 'KNOWLEDGE_VAULTS')
  );
  for (const root of duplicates) {
    console.warn(
      `KNOWLEDGE_VAULTS の "${root}" は、同じ名前（${path.basename(root)}）の保管庫が先にあるため使いません`
    );
  }
  for (const vault of vaults.slice(MAX_KNOWLEDGE_VAULTS)) {
    console.warn(
      `KNOWLEDGE_VAULTS の保管庫は ${MAX_KNOWLEDGE_VAULTS} 個までのため "${vault.root}" を使いません`
    );
  }
  cachedVaults = vaults.slice(0, MAX_KNOWLEDGE_VAULTS);
  return cachedVaults;
}

/**
 * 名前から、設定にある保管庫を探す。
 *
 * @param name - 保管庫の名前
 * @returns 保管庫。設定に無ければ `undefined`
 */
export function findKnowledgeVault(name: string): VaultRoot | undefined {
  return getKnowledgeVaults().find((vault) => vault.name === name);
}

/**
 * 検索で比べるドキュメントの条件（画面から上げたもの + 設定にある保管庫のもの。#235 の C7）。
 *
 * @returns SQL の条件（`d` は KnowledgeDocument の別名）
 */
export function searchableVaultCondition(): Prisma.Sql {
  const names = getKnowledgeVaults().map((vault) => vault.name);
  return names.length > 0
    ? Prisma.sql`(d."vault" IS NULL OR d."vault" IN (${Prisma.join(names)}))`
    : Prisma.sql`d."vault" IS NULL`;
}

/**
 * 検索で比べるドキュメントの条件の Prisma の形（{@link searchableVaultCondition} と同じ範囲）。
 *
 * @returns `where` に渡す条件
 */
export function searchableVaultWhere(): Prisma.KnowledgeDocumentWhereInput {
  const names = getKnowledgeVaults().map((vault) => vault.name);
  return { OR: [{ vault: null }, { vault: { in: names } }] };
}
