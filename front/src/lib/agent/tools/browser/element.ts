import type { Locator, Page } from 'playwright-core';
import { takeSnapshot } from './snapshot';

/**
 * 要素の参照の形。`e12`（ページの要素）か `f1e3`（iframe の中の要素）。
 * モデルがスナップショットの書き方のまま `[ref=e12]`・`ref=e12` と渡すこともあるため、囲みを外して読む
 */
const REF_PATTERN = /^\[?(?:ref=)?((?:f\d+)?e\d+)\]?$/;

/**
 * スナップショットの要素の行（`- button "送信する" [ref=e10]`・`- textbox "名前": 田中`・`- list`）から、
 * 役割（`button`）と名前（`送信する`）を取る。名前の中の `"` は `\"` と書かれるため、`\` の後の 1 文字を名前に含める
 */
const ELEMENT_LINE_PATTERN = /^-\s+([a-zA-Z]+)(?:\s+"((?:[^"\\]|\\.)*)")?/;

/**
 * モデルが渡した要素の参照を読む（#149 Phase C）。
 *
 * @param raw - モデルが渡した値（`e12`・`f1e3`。`[ref=e12]` の形も受け付ける）
 * @returns 参照（`e12` の形）、または読めない理由
 */
export function parseRef(
  raw: unknown
): { ok: true; value: string } | { ok: false; reason: string } {
  const match = typeof raw === 'string' ? REF_PATTERN.exec(raw.trim()) : null;
  if (!match) {
    return {
      ok: false,
      reason:
        'ref はページの内容の [ref=e12] の e12 の形で指定してください（iframe の中は f1e3 の形）',
    };
  }
  return { ok: true, value: match[1] };
}

/**
 * 要素のスナップショット（`locator.ariaSnapshot()`）の 1 行目から、要素を表す文字を作る（#149 Phase C）。
 *
 * 承認カードと照合に使うため、役割と名前だけにする（値・状態・参照は含めない。入力すると値が変わり、照合が外れるため）。
 *
 * @param snapshot - 要素のスナップショット
 * @returns `button "送信する"` の形（名前が無ければ役割だけ）。読めなければ `undefined`
 */
export function describeElementLine(snapshot: string): string | undefined {
  const match = ELEMENT_LINE_PATTERN.exec(snapshot.split('\n')[0].trim());
  if (!match) return undefined;
  const [, role, name] = match;
  return name ? `${role} "${name}"` : role;
}

/**
 * スナップショットから、参照の付いた要素の行を探す（#149 Phase C）。
 *
 * @param snapshot - ページ全体のスナップショット（参照付き）
 * @param ref - 要素の参照
 * @returns 要素の行（字下げを除く）。無ければ `undefined`
 */
export function findRefLine(snapshot: string, ref: string): string | undefined {
  // `[ref=e1]` は閉じ括弧まで含めて探す（`[ref=e12]` に当てない）
  const marker = `[ref=${ref}]`;
  return snapshot
    .split('\n')
    .find((line) => line.includes(marker))
    ?.trim();
}

/** {@link findElement} の結果。 */
export type FoundElement =
  | {
      ok: true;
      /** 参照で指した要素 */
      locator: Locator;
      /** 要素を表す文字（`button "送信する"`） */
      element: string;
    }
  | { ok: false; reason: string };

/**
 * ページの中から、参照で要素を探し、役割と名前を引く（#149 Phase C）。
 *
 * ページ全体のスナップショットを取り直し、その中から参照の行を探す。変わっていない要素は同じ参照のまま残り、
 * 消えた要素・名前が変わって参照が新しくなった要素は見つからない（読み直しを促す）。
 * 要素だけのスナップショット（`locator.ariaSnapshot()`）は取らない。Playwright は最後に取ったスナップショットの表で
 * 参照を引くため、要素だけを取ると表がその要素の分に置き換わり、参照が引けなくなる（`docs/18-browser-tools.md`「Phase C の前提の調査」）。
 *
 * @param page - 操作するページ
 * @param ref - 要素の参照（{@link parseRef} で読んだもの）
 * @returns 要素と、要素を表す文字。見つからない・読めなければ理由
 */
export async function findElement(
  page: Page,
  ref: string
): Promise<FoundElement> {
  const line = findRefLine(await takeSnapshot(page), ref);
  if (!line) {
    return {
      ok: false,
      reason: `参照 ${ref} の要素が見つかりません（消えたか、表示が変わって参照が新しくなった可能性があります）。browser_snapshot で読み直し、新しい参照を使ってください`,
    };
  }
  const element = describeElementLine(line);
  if (!element) {
    return {
      ok: false,
      reason: `参照 ${ref} の要素の役割を読めませんでした`,
    };
  }
  return { ok: true, locator: page.locator(`aria-ref=${ref}`), element };
}
