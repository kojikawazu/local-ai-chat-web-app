import { DIAGRAM_FONT_FAMILY, PLANTUML_API } from '@/constants/chat/diagram';
import type { DocImage } from '@/lib/chat/document-model';
import {
  getPngSize,
  svgToDataUri,
  toPlantUmlDiagramState,
  withIntrinsicSize,
} from '@/lib/chat/diagram';
import type { ReportDiagram, ReportImage } from '@/lib/chat/report-html';
import { diagramKey } from '@/lib/chat/report-html';
import { svgToPngBlob } from '@/lib/shared/image';
import type { MessageImage } from '@/types/chat/message';

/**
 * 書き出し（HTML レポート・PDF・DOCX。#36）に埋め込む図と画像を用意する関数群（ブラウザの中の I/O）。
 *
 * 図は Mermaid をブラウザで、PlantUML を `/api/diagrams/plantuml` で SVG に描く。添付画像は `data:` URI にする。
 * どれも失敗したものは結果に入れず（ログに残す）、書き出しの側でソース・注記にして続ける。
 */

/**
 * Mermaid の図を、レポート向けの明るいテーマで SVG の `data:` URI に描く。
 *
 * mermaid は並べて描くと内部の状態が混ざるため、呼び出し側が 1 つずつ順に呼ぶ。`initialize` はページ全体の設定だが、
 * 画面の図（`useMermaidDiagram`）は描く直前に毎回テーマを設定し直すため、ここで明るいテーマにしても画面の図に残らない。
 *
 * @param source - Mermaid のソース
 * @param index - ページの中で重ならない要素 ID を作るための番号
 * @returns SVG の `data:` URI
 */
async function renderMermaid(source: string, index: number): Promise<string> {
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
    theme: 'default',
    fontFamily: DIAGRAM_FONT_FAMILY,
  });
  const { svg } = await mermaid.render(`report-mermaid-${index}`, source);
  return svgToDataUri(withIntrinsicSize(svg));
}

/**
 * PlantUML の図を、PlantUML サーバー（`/api/diagrams/plantuml`）で SVG の `data:` URI に描かせる。
 *
 * @param source - PlantUML のソース
 * @returns SVG の `data:` URI
 * @throws {Error} 描けなかった場合
 */
async function renderPlantUml(source: string): Promise<string> {
  const res = await fetch(PLANTUML_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source }),
  });
  const state = toPlantUmlDiagramState(
    res.ok,
    await res.json().catch(() => null)
  );
  if (state.status !== 'rendered') {
    throw new Error(
      state.status === 'error' ? state.error : 'PlantUML の図を描けませんでした'
    );
  }
  return state.src;
}

/**
 * 図をすべて描く。描けなかった図は結果に入れない（書き出しではソースのコードブロックのまま残す）。
 *
 * @param diagrams - 描く図
 * @returns 描けた図（キーは `diagramKey`、値は SVG の `data:` URI）
 */
export async function renderDiagrams(
  diagrams: ReportDiagram[]
): Promise<Map<string, string>> {
  const rendered = new Map<string, string>();
  await Promise.all(
    diagrams
      .filter((diagram) => diagram.kind === 'plantuml')
      .map(async (diagram) => {
        try {
          rendered.set(
            diagramKey(diagram.kind, diagram.source),
            await renderPlantUml(diagram.source)
          );
        } catch (error) {
          console.error('Failed to render PlantUML diagram for report:', error);
        }
      })
  );
  const mermaidDiagrams = diagrams.filter(
    (diagram) => diagram.kind === 'mermaid'
  );
  for (const [index, diagram] of mermaidDiagrams.entries()) {
    try {
      rendered.set(
        diagramKey(diagram.kind, diagram.source),
        await renderMermaid(diagram.source, index)
      );
    } catch (error) {
      console.error('Failed to render Mermaid diagram for report:', error);
    }
  }
  return rendered;
}

/**
 * Blob を `data:` URI にする。
 *
 * @param blob - 画像の Blob
 * @returns `data:` URI
 */
function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('画像を読み込めませんでした'));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * 添付画像を、書き出しに埋め込む `data:` URI にする。読めなかった画像は `null`（書き出しでは注記にする）。
 *
 * 送ったばかりの画像は表示の URL がもう `data:` URI、DB から読み直した画像は `/api/attachments/[id]` から読む。
 *
 * @param image - 添付画像
 * @returns 埋め込む画像。読めなければ `null`
 */
export async function loadReportImage(
  image: MessageImage
): Promise<ReportImage> {
  try {
    if (image.src.startsWith('data:')) {
      return { dataUri: image.src, width: image.width, height: image.height };
    }
    const res = await fetch(image.src);
    if (!res.ok) throw new Error(`画像の取得に失敗しました (${res.status})`);
    return {
      dataUri: await blobToDataUri(await res.blob()),
      width: image.width,
      height: image.height,
    };
  } catch (error) {
    console.error('Failed to load image for report:', error);
    return null;
  }
}

/**
 * 画像の元の大きさを読む。
 *
 * @param src - 画像の URL（`data:` URI）
 * @returns 元の幅と高さ（px）
 */
function readImageSize(
  src: string
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('図を読み込めませんでした'));
    image.src = src;
  });
}

/**
 * 描けた図（SVG の `data:` URI）を、DOCX に埋め込む PNG にする（#36。白い背景・2 倍の解像度）。
 * PNG にできなかった図は結果に入れない（DOCX ではソースのコードブロックのまま残す）。
 *
 * 表示の大きさは図の元の大きさにし（本文の幅に収めるのは DOCX の側）、PNG は高解像度の画面でも粗くならない大きさで描く
 * （図の PNG の保存（#176）と同じ `getPngSize`・`svgToPngBlob`）。
 *
 * @param diagrams - 描けた図（キーは `diagramKey`、値は SVG の `data:` URI）
 * @returns PNG の図（キーは同じ）
 */
export async function diagramsToPng(
  diagrams: ReadonlyMap<string, string>
): Promise<Map<string, DocImage>> {
  const images = new Map<string, DocImage>();
  for (const [key, src] of diagrams) {
    try {
      const size = await readImageSize(src);
      const pngSize = getPngSize(size.width, size.height);
      if (!pngSize) continue;
      const blob = await svgToPngBlob(src, {
        ...pngSize,
        background: '#ffffff',
      });
      images.set(key, {
        data: new Uint8Array(await blob.arrayBuffer()),
        mimeType: 'image/png',
        width: size.width,
        height: size.height,
        alt: '図',
      });
    } catch (error) {
      console.error('Failed to convert diagram to PNG for report:', error);
    }
  }
  return images;
}
