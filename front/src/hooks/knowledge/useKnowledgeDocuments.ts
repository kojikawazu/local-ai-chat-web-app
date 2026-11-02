'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  compareKnowledgeNames,
  knowledgeFileKind,
  tooLargeError,
  unsupportedExtensionError,
} from '@/lib/knowledge/file';
import { MAX_KNOWLEDGE_FILE_BYTES } from '@/lib/shared/validation';
import type { KnowledgeDocumentItem } from '@/types/knowledge/document';

const DOCUMENTS_URL = '/api/knowledge/documents';
/** 削除の対象が既に無いときのステータス。消えたものとして扱う */
const NOT_FOUND = 404;

/**
 * 取り込みの 1 ファイルの進み具合（取り込み中・失敗したものだけを持つ。終わったものは一覧に入る）。
 */
export type KnowledgeUpload = {
  /** 画面のキー（同じ名前のファイルを続けて選んでも区別する） */
  key: string;
  /** ファイル名 */
  name: string;
  /** `waiting` は順番待ち、`importing` は取り込み中、`error` は失敗 */
  state: 'waiting' | 'importing' | 'error';
  /** 失敗の理由（`error` のときだけ） */
  error?: string;
};

/**
 * API の失敗の応答から、利用者へ見せる文を取り出す。
 *
 * @param res - 失敗の応答
 * @param fallback - API が `error` を返さなかったときの文
 * @returns 理由の文
 */
async function errorOf(res: Response, fallback: string): Promise<string> {
  const data: { error?: unknown } = await res.json().catch(() => ({}));
  return typeof data.error === 'string'
    ? data.error
    : `${fallback} (${res.status})`;
}

/**
 * ドキュメントを名前の昇順に並べる（API の一覧と同じ順。取り込んだものを足したときに使う）。
 *
 * @param documents - ドキュメント
 * @returns 並べた新しい配列
 */
function sortByName(documents: KnowledgeDocumentItem[]) {
  return [...documents].sort((a, b) => compareKnowledgeNames(a.name, b.name));
}

/**
 * 送る前にファイルを確かめる（拡張子・大きさ）。中身が UTF-8 かは API が確かめる。
 *
 * 大きすぎるファイルを送らずに済ませ、すぐに理由を出す。
 *
 * @param file - 選んだファイル
 * @returns 送れないなら理由。送れるなら `null`
 */
function precheck(file: File): string | null {
  if (!knowledgeFileKind(file.name)) {
    return unsupportedExtensionError();
  }
  if (file.size > MAX_KNOWLEDGE_FILE_BYTES) return tooLargeError();
  return null;
}

/**
 * RAG のドキュメントの一覧を読み、取り込み・作り直し・削除を提供するフック（#17。`docs/28-rag.md`「管理画面」）。
 *
 * マウント時に一覧を読む。選んだファイルは 1 つずつ順に取り込み（取り込みは応答の中で埋め込みまで作り、数十秒
 * かかることがある）、終わったものを一覧に入れる。失敗したファイルは理由を残し、残りのファイルは続ける。
 *
 * @returns `status`（一覧の読み込みの状態）・`documents`・`embeddingModel`（今の埋め込みのモデル）・`loadError`・
 *   `uploads`（取り込み中・失敗のファイル）・`busyIds`（作り直し・削除の途中のドキュメント）・`itemErrors`（ドキュメントごとの失敗）と、
 *   `importFiles`・`rebuildDocument`・`deleteDocument`
 */
export function useKnowledgeDocuments() {
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');
  const [documents, setDocuments] = useState<KnowledgeDocumentItem[]>([]);
  const [embeddingModel, setEmbeddingModel] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<KnowledgeUpload[]>([]);
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(DOCUMENTS_URL);
        if (!res.ok) {
          const error = await errorOf(
            res,
            'ドキュメントの一覧の取得に失敗しました'
          );
          if (!cancelled) {
            setLoadError(error);
            setStatus('error');
          }
          return;
        }
        const data: {
          documents: KnowledgeDocumentItem[];
          embeddingModel: string;
        } = await res.json();
        // マウントの解除後に state を書かない
        if (cancelled) return;
        setDocuments(data.documents);
        setEmbeddingModel(data.embeddingModel);
        setStatus('done');
      } catch (error) {
        console.error('Failed to fetch knowledge documents:', error);
        if (!cancelled) {
          setLoadError('ドキュメントの一覧の取得に失敗しました');
          setStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 返ってきたドキュメントを一覧に入れる（同じ ID は置き換える） */
  const putDocument = useCallback((document: KnowledgeDocumentItem) => {
    setDocuments((current) =>
      sortByName([...current.filter((d) => d.id !== document.id), document])
    );
  }, []);

  /**
   * 選んだファイルを 1 つずつ取り込む。前に失敗したファイルの表示は消す。
   *
   * @param files - 選んだ・落としたファイル
   */
  const importFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const batch = files.map((file, index) => ({
        file,
        key: `${Date.now()}-${index}`,
      }));
      setUploads(
        batch.map(({ file, key }) => ({
          key,
          name: file.name,
          state: 'waiting',
        }))
      );
      const update = (key: string, patch: Partial<KnowledgeUpload>) =>
        setUploads((current) =>
          current.map((u) => (u.key === key ? { ...u, ...patch } : u))
        );
      const finish = (key: string) =>
        setUploads((current) => current.filter((u) => u.key !== key));

      for (const { file, key } of batch) {
        const rejected = precheck(file);
        if (rejected) {
          update(key, { state: 'error', error: rejected });
          continue;
        }
        update(key, { state: 'importing' });
        try {
          const form = new FormData();
          form.append('file', file);
          const res = await fetch(DOCUMENTS_URL, {
            method: 'POST',
            body: form,
          });
          if (!res.ok) {
            update(key, {
              state: 'error',
              error: await errorOf(res, '取り込みに失敗しました'),
            });
            continue;
          }
          const data: { document: KnowledgeDocumentItem } = await res.json();
          putDocument(data.document);
          finish(key);
        } catch (error) {
          console.error('Failed to import knowledge document:', error);
          update(key, { state: 'error', error: '取り込みに失敗しました' });
        }
      }
    },
    [putDocument]
  );

  /**
   * ドキュメントの作り直し・削除を、途中の印と失敗の表示を付けて行う。
   *
   * @param id - ドキュメントの ID
   * @param run - 行う処理。失敗なら理由を返す（成功なら `null`）
   */
  const runItemAction = useCallback(
    async (id: string, run: () => Promise<string | null>) => {
      setBusyIds((current) => [...current, id]);
      setItemErrors((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([key]) => key !== id)
        )
      );
      let error: string | null;
      try {
        error = await run();
      } catch (thrown) {
        console.error('Knowledge document action failed:', thrown);
        error = '通信に失敗しました';
      }
      setBusyIds((current) => current.filter((busy) => busy !== id));
      if (error) setItemErrors((current) => ({ ...current, [id]: error }));
    },
    []
  );

  /**
   * 今の埋め込みのモデルでドキュメントを作り直す。
   *
   * @param id - ドキュメントの ID
   */
  const rebuildDocument = useCallback(
    (id: string) =>
      runItemAction(id, async () => {
        const res = await fetch(`${DOCUMENTS_URL}/${id}/rebuild`, {
          method: 'POST',
        });
        if (!res.ok) return errorOf(res, '作り直しに失敗しました');
        const data: { document: KnowledgeDocumentItem } = await res.json();
        putDocument(data.document);
        return null;
      }),
    [putDocument, runItemAction]
  );

  /**
   * ドキュメントを削除する。別のタブ等で既に消えていた（404）ときも、消えたものとして一覧から外す。
   *
   * @param id - ドキュメントの ID
   */
  const deleteDocument = useCallback(
    (id: string) =>
      runItemAction(id, async () => {
        const res = await fetch(`${DOCUMENTS_URL}/${id}`, { method: 'DELETE' });
        if (!res.ok && res.status !== NOT_FOUND) {
          return errorOf(res, '削除に失敗しました');
        }
        setDocuments((current) => current.filter((d) => d.id !== id));
        return null;
      }),
    [runItemAction]
  );

  return {
    status,
    documents,
    embeddingModel,
    loadError,
    uploads,
    busyIds,
    itemErrors,
    importFiles,
    rebuildDocument,
    deleteDocument,
  };
}
