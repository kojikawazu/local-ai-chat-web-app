/** 構文木（hast）のうち、コードブロックの読み取りに使う部分だけの形 */
export type HastNode = {
  /** ノードの種類（`element` / `text` 等） */
  type: string;
  /** 要素のタグ名（`type` が `element` のときだけ） */
  tagName?: string;
  /** 要素の属性（`className` は配列で入る） */
  properties?: Record<string, unknown>;
  /** テキストノードの値 */
  value?: string;
  /** 子ノード */
  children?: HastNode[];
};

/** Markdown のコードフェンスに書いた言語名が付くクラスの接頭辞（mdast-util-to-hast の仕様） */
const LANGUAGE_CLASS_PREFIX = 'language-';

/**
 * 構文木のノード配下の文字列を連結して返す（DOM の `textContent` 相当）。
 *
 * ハイライト後のコードブロックは本文がトークンごとの `span` に分かれるが、連結すれば元の本文に戻る。
 *
 * @param node - 対象のノード
 * @returns 配下のテキストノードの値を順に連結した文字列
 */
export function hastToText(node: HastNode): string {
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(hastToText).join('');
}

/**
 * コードブロック（`pre` 要素）から、コードフェンスに書かれた言語名を取り出す（#144）。
 *
 * 言語名は `code` 子要素の `language-xxx` クラスから読む。ハイライトの有無（`hljs` クラスの
 * 付与）や、言語が highlight.js に登録されているかには左右されない。
 *
 * @param pre - コードブロックの `pre` 要素
 * @returns 書かれたままの言語名（例: `ts`）。言語の指定が無ければ `null`
 */
export function getCodeLanguage(pre: HastNode): string | null {
  const code = pre.children?.find(
    (child) => child.type === 'element' && child.tagName === 'code'
  );
  const className = code?.properties?.className;
  if (!Array.isArray(className)) return null;

  for (const name of className) {
    if (typeof name !== 'string' || !name.startsWith(LANGUAGE_CLASS_PREFIX)) {
      continue;
    }
    const language = name.slice(LANGUAGE_CLASS_PREFIX.length);
    if (language) return language;
  }
  return null;
}
