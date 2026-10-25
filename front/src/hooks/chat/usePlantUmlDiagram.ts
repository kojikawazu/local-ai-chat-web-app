import { useEffect, useState } from 'react';
import { toPlantUmlDiagramState } from '@/lib/chat/diagram';
import { MAX_DIAGRAM_SOURCE_LENGTH } from '@/lib/shared/validation';
import type { DiagramState } from '@/types/chat/diagram';

/** PlantUML の図を描かせる API */
const PLANTUML_API = '/api/diagrams/plantuml';

/** 上限を超えるソースのメッセージ（API と同じ上限で、送る前に止める） */
const TOO_LONG_ERROR = `図のソースが長すぎます（上限 ${MAX_DIAGRAM_SOURCE_LENGTH.toLocaleString('ja-JP')} 文字）`;

/** API に届かなかったとき（通信の失敗）のメッセージ */
const REQUEST_FAILED_ERROR = 'PlantUML の図を取得できませんでした';

/** 描画の結果と、それを描いたときのソース（ソースが変わったら古い結果を使わないため） */
type RenderResult = DiagramState & { source: string };

/**
 * PlantUML のソースを `/api/diagrams/plantuml` で SVG にし、`<img>` に入れる data: URI を返す（#171）。
 *
 * 描いている間と、生成中（`enabled` が `false`）・空のソースのときは `idle` を返し、呼び出し側は
 * ソースを表示する。上限を超えるソースは送らずに `error` を返す。ソースが変わったとき・アンマウントしたときは、
 * 前のリクエストを止める。PlantUML の図はテーマに追従させない（`docs/11` の「配色」）。
 *
 * @param source - PlantUML のソース
 * @param enabled - 描いてよいか。応答の生成中は `false` にし、書きかけの構文を送らない
 * @returns 描画の状態（`rendered` なら `src`、`error` なら理由を持つ）
 */
export function usePlantUmlDiagram(
  source: string,
  enabled: boolean
): DiagramState {
  const [result, setResult] = useState<RenderResult | null>(null);
  const shouldRender = enabled && source.trim() !== '';
  const isTooLong = source.length > MAX_DIAGRAM_SOURCE_LENGTH;

  useEffect(() => {
    if (!shouldRender || isTooLong) return;
    const controller = new AbortController();

    const render = async () => {
      try {
        const res = await fetch(PLANTUML_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source }),
          signal: controller.signal,
        });
        const json: unknown = await res.json().catch(() => null);
        setResult({ ...toPlantUmlDiagramState(res.ok, json), source });
      } catch (error) {
        // ソースが変わった・アンマウントしたことによる中断は失敗として扱わない
        if (controller.signal.aborted) return;
        console.error('Failed to render PlantUML diagram:', error);
        setResult({ status: 'error', error: REQUEST_FAILED_ERROR, source });
      }
    };
    void render();

    return () => controller.abort();
  }, [source, shouldRender, isTooLong]);

  if (!shouldRender) return { status: 'idle' };
  if (isTooLong) return { status: 'error', error: TOO_LONG_ERROR };
  // ソースが変わった直後は前の結果が残っているため、今のソースで描いた結果だけを使う
  if (result?.source !== source) return { status: 'idle' };
  if (result.status === 'rendered') {
    return { status: 'rendered', src: result.src };
  }
  if (result.status === 'error') {
    return { status: 'error', error: result.error };
  }
  return { status: 'idle' };
}
