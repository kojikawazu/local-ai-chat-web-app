'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PromptTemplate } from '@/types/prompt-template/prompt-template';

const TEMPLATES_URL = '/api/prompt-templates';
/** 削除の対象が既に無いときのステータス。消えたものとして扱う */
const NOT_FOUND = 404;

/** 作成・置き換えで送る値（管理画面のフォームの入力）。 */
type PromptTemplateInput = Pick<
  PromptTemplate,
  'name' | 'shortcut' | 'content'
>;

/**
 * API を呼び、失敗なら API の `error` を持つ例外を投げる。
 *
 * @param url - 呼ぶ API
 * @param init - `fetch` の設定
 * @param fallbackError - API が `error` を返さなかったときの文言
 * @param acceptedStatus - 失敗にしないステータス（削除の 404 等）。省略時は無し
 * @throws {Error} API がエラーを返した、または通信に失敗した場合
 */
async function requestOrThrow(
  url: string,
  init: RequestInit,
  fallbackError: string,
  acceptedStatus?: number
): Promise<void> {
  const res = await fetch(url, init);
  if (res.ok || res.status === acceptedStatus) return;
  const data: { error?: unknown } = await res.json().catch(() => ({}));
  throw new Error(
    typeof data.error === 'string'
      ? data.error
      : `${fallbackError} (${res.status})`
  );
}

/**
 * JSON のボディを送る `fetch` の設定を作る。
 *
 * @param method - HTTP メソッド
 * @param body - 送る値
 * @returns `fetch` の設定
 */
function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * テンプレートの一覧を API から読む。
 *
 * @returns 一覧。API がエラーを返した・通信に失敗したときは `null`
 */
async function fetchTemplates(): Promise<PromptTemplate[] | null> {
  try {
    const res = await fetch(TEMPLATES_URL);
    if (!res.ok) return null;
    const data: { templates: PromptTemplate[] } = await res.json();
    return data.templates;
  } catch (error) {
    console.error('Failed to fetch prompt templates:', error);
    return null;
  }
}

/**
 * プロンプトテンプレートの一覧を読み、作成・置き換え・削除・例の追加を提供するフック（#28）。
 *
 * マウント時に一覧を読む。変更が成功したら一覧を読み直す（並びは API のショートカットの昇順に任せる）。
 * 変更の失敗は例外で返す（管理画面に API の `error` を出し、入力を残すため）。
 *
 * @returns `templates` はテンプレートの一覧（読み込み中・読めなかったときは `null`。このとき入力欄の候補は出さない）、
 *   `createTemplate`・`updateTemplate`・`deleteTemplate`・`addExampleTemplates` は変更（失敗時は例外を投げる）
 */
export function usePromptTemplates() {
  const [templates, setTemplates] = useState<PromptTemplate[] | null>(null);

  /** 一覧を読み直す。読めなければ `null` にする（古い一覧で候補を出さない）。 */
  const load = useCallback(async () => {
    setTemplates(await fetchTemplates());
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchTemplates().then((loaded) => {
      // マウントの解除後に state を書かない
      if (!cancelled) setTemplates(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * テンプレートを作成する。
   *
   * @param input - 名前・ショートカット・本文
   * @throws {Error} API がエラー（重複の 409 等）を返した、または通信に失敗した場合
   */
  const createTemplate = useCallback(
    async (input: PromptTemplateInput) => {
      await requestOrThrow(
        TEMPLATES_URL,
        jsonInit('POST', input),
        'テンプレートの作成に失敗しました'
      );
      await load();
    },
    [load]
  );

  /**
   * テンプレートを置き換える。
   *
   * @param id - 対象のテンプレートの ID
   * @param input - 置き換え後の名前・ショートカット・本文
   * @throws {Error} API がエラー（重複の 409・見つからない 404 等）を返した、または通信に失敗した場合
   */
  const updateTemplate = useCallback(
    async (id: string, input: PromptTemplateInput) => {
      await requestOrThrow(
        `${TEMPLATES_URL}/${id}`,
        jsonInit('PUT', input),
        'テンプレートの更新に失敗しました'
      );
      await load();
    },
    [load]
  );

  /**
   * テンプレートを削除する。別のタブ等で既に消えていた（404）ときも、消えたものとして一覧を読み直す。
   *
   * @param id - 削除するテンプレートの ID
   * @throws {Error} API が 404 以外のエラーを返した、または通信に失敗した場合
   */
  const deleteTemplate = useCallback(
    async (id: string) => {
      await requestOrThrow(
        `${TEMPLATES_URL}/${id}`,
        { method: 'DELETE' },
        'テンプレートの削除に失敗しました',
        NOT_FOUND
      );
      await load();
    },
    [load]
  );

  /**
   * 例のテンプレート 4 件を作る（一覧が空のときだけ API が受け付ける）。
   *
   * @throws {Error} API がエラー（一覧が空でない 409 等）を返した、または通信に失敗した場合
   */
  const addExampleTemplates = useCallback(async () => {
    try {
      await requestOrThrow(
        `${TEMPLATES_URL}/examples`,
        { method: 'POST' },
        '例のテンプレートの作成に失敗しました'
      );
    } finally {
      // 409（別のタブで作られていた）でも、今の一覧を出す
      await load();
    }
  }, [load]);

  return {
    templates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    addExampleTemplates,
  };
}
