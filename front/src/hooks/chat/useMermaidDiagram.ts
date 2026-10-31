import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import {
  buildMermaidThemeVariables,
  svgToDataUri,
  toMermaidId,
  withIntrinsicSize,
} from '@/lib/chat/diagram';
import type { DiagramState } from '@/types/chat/diagram';
import { DIAGRAM_FONT_FAMILY } from '@/constants/chat/diagram';

/** テーマを表す `<html>` の属性（`useTheme` が付け外しする） */
const THEME_ATTRIBUTE = 'data-theme';

/** 描画の結果と、それを描いたときのソース（ソースが変わったら古い結果を使わないため） */
type RenderResult = DiagramState & { source: string };

/**
 * `<html>` の `data-theme` の変化を購読する（`useSyncExternalStore` 用）。
 *
 * @param onChange - 変化したときに呼ぶ関数
 * @returns 購読をやめる関数
 */
function subscribeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [THEME_ATTRIBUTE],
  });
  return () => observer.disconnect();
}

/**
 * 今のテーマ（`data-theme` の値。既定のテーマは属性が無いため空文字）を返す。
 *
 * @returns `data-theme` の値
 */
function getTheme(): string {
  return document.documentElement.getAttribute(THEME_ATTRIBUTE) ?? '';
}

/**
 * サーバーでの描画時のテーマ（属性を読めないため空文字）を返す。
 *
 * @returns 空文字
 */
function getServerTheme(): string {
  return '';
}

/**
 * Mermaid のソースを図に描き、`<img>` に入れる data: URI を返す（#169）。
 *
 * mermaid は使うときにだけ読み込む。テーマの CSS 変数の色で描き、テーマが切り替わったら描き直す。
 * 描いている間と、生成中（`enabled` が `false`）・空のソースのときは `idle` を返し、呼び出し側は
 * ソースを表示する。描けなかったときは `error` を返す。
 *
 * @param source - Mermaid のソース
 * @param enabled - 描いてよいか。応答の生成中は `false` にし、書きかけの構文を描かせない
 * @returns 描画の状態（`rendered` なら `src`、`error` なら mermaid のメッセージを持つ）
 */
export function useMermaidDiagram(
  source: string,
  enabled: boolean
): DiagramState {
  const id = toMermaidId(useId());
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getServerTheme);
  const [result, setResult] = useState<RenderResult | null>(null);
  const shouldRender = enabled && source.trim() !== '';

  useEffect(() => {
    if (!shouldRender) return;
    let cancelled = false;

    const render = async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        const style = getComputedStyle(document.documentElement);
        // initialize はページ全体の設定。どの図も今のテーマで描くため、描く直前に毎回呼んでよい
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          htmlLabels: false,
          theme: 'base',
          themeVariables: buildMermaidThemeVariables((name) =>
            style.getPropertyValue(name)
          ),
          fontFamily: DIAGRAM_FONT_FAMILY,
        });
        const { svg } = await mermaid.render(id, source);
        if (cancelled) return;
        const sized = withIntrinsicSize(svg);
        setResult({
          status: 'rendered',
          src: svgToDataUri(sized),
          svg: sized,
          source,
        });
      } catch (error) {
        console.error('Failed to render Mermaid diagram:', error);
        if (cancelled) return;
        setResult({
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
          source,
        });
      }
    };
    void render();

    return () => {
      cancelled = true;
    };
  }, [id, source, theme, shouldRender]);

  // ソースが変わった直後は前の結果が残っているため、今のソースで描いた結果だけを使う。
  // テーマの切り替えでは、描き直すまで前のテーマの図を出しておく（ソースに戻すとちらつく）
  if (!shouldRender || result?.source !== source) {
    return { status: 'idle' };
  }
  if (result.status === 'rendered') {
    return { status: 'rendered', src: result.src, svg: result.svg };
  }
  if (result.status === 'error') {
    return { status: 'error', error: result.error };
  }
  return { status: 'idle' };
}
