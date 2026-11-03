'use client';

import { useCallback, useEffect, useState } from 'react';
import type { KnowledgeDocumentItem } from '@/types/knowledge/document';

const DOCUMENTS_URL = '/api/knowledge/documents';

/**
 * 取り込んだドキュメントがあるかを調べるフック（#17 Phase B。入力欄の「ドキュメントを参照」の切り替えに使う）。
 *
 * マウント時に一覧の API を読む（本文・埋め込みは返らないため軽い）。ドキュメントの管理画面を閉じたときなど、
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
        const res = await fetch(DOCUMENTS_URL);
        if (!res.ok || cancelled) return;
        const data: { documents?: KnowledgeDocumentItem[] } = await res.json();
        if (!cancelled && Array.isArray(data.documents)) {
          setHasDocuments(data.documents.length > 0);
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
