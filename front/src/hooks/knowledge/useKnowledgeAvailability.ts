'use client';

import { useCallback, useEffect, useState } from 'react';
import type { KnowledgeDocumentItem } from '@/types/knowledge/document';
import type { KnowledgeVaultItem } from '@/types/knowledge/vault';

const DOCUMENTS_URL = '/api/knowledge/documents';
const VAULTS_URL = '/api/knowledge/vaults';

/**
 * 取り込んだドキュメントがあるかを調べるフック（#17 Phase B。入力欄の「ドキュメントを参照」の切り替えに使う）。
 *
 * マウント時に一覧の API を読む（本文・埋め込みは返らないため軽い）。画面から上げたドキュメントか、設定にある保管庫（#235）の
 * 同期したファイルが 1 つでもあれば「ある」とする。ドキュメントの管理画面を閉じたときなど、
 * 一覧が変わりうるときに `refresh` で読み直す（読み直しの回数を変えて、effect に読ませる）。
 * 読めなかったときは、あるかどうか分からないため前の値のままにする（最初は `null` で、切り替えを止めない）。
 *
 * @returns `hasDocuments`（1 つ以上あれば true・無ければ false・読めていなければ `null`）と、読み直す `refresh`
 */
export function useKnowledgeAvailability() {
  const [hasDocuments, setHasDocuments] = useState<boolean | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [documentsRes, vaultsRes] = await Promise.all([
          fetch(DOCUMENTS_URL),
          fetch(VAULTS_URL),
        ]);
        if (!documentsRes.ok || !vaultsRes.ok || cancelled) return;
        const documents: { documents?: KnowledgeDocumentItem[] } =
          await documentsRes.json();
        const vaults: { vaults?: KnowledgeVaultItem[] } =
          await vaultsRes.json();
        if (
          !cancelled &&
          Array.isArray(documents.documents) &&
          Array.isArray(vaults.vaults)
        ) {
          setHasDocuments(
            documents.documents.length > 0 ||
              vaults.vaults.some(
                (vault) => vault.configured && vault.documentCount > 0
              )
          );
        }
      } catch (error) {
        console.error('Failed to fetch knowledge documents:', error);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [version]);

  const refresh = useCallback(() => {
    setVersion((current) => current + 1);
  }, []);

  return { hasDocuments, refresh };
}
