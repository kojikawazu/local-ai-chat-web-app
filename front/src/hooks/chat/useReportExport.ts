'use client';

import { useCallback, useState } from 'react';
import { DIAGRAM_FONT_FAMILY, PLANTUML_API } from '@/constants/chat/diagram';
import {
  svgToDataUri,
  toPlantUmlDiagramState,
  withIntrinsicSize,
} from '@/lib/chat/diagram';
import { buildExportFileName } from '@/lib/chat/export';
import type {
  ReportDiagram,
  ReportImage,
  ReportInput,
} from '@/lib/chat/report-html';
import {
  buildReportHtml,
  collectDiagrams,
  diagramKey,
} from '@/lib/chat/report-html';
import { downloadTextFile } from '@/lib/shared/download';
import { printHtml } from '@/lib/shared/print';
import type { Message, MessageImage } from '@/types/chat/message';

/** レポートの形式。`html` はファイルに保存、`pdf` は同じ HTML をブラウザの印刷で開く */
export type ReportFormat = 'html' | 'pdf';

/** レポートの書き出しの指示。 */
export type ReportExportRequest = {
  /** 形式 */
  format: ReportFormat;
  /** `conversation` は会話全体、`message` は応答 1 件 */
  mode: ReportInput['mode'];
  /** 会話のタイトル */
  title: string;
  /** 会話の役割（会話全体のときだけ出す）。無ければ `null` */
  systemPrompt: string | null;
  /** 書き出すメッセージ（古い順。応答 1 件のときはその応答だけ） */
  messages: Message[];
  /** 書き出した日時 */
  exportedAt: Date;
};

/** HTML のファイルの MIME タイプ */
const HTML_MIME = 'text/html;charset=utf-8';

/** 書き出しそのもの（組み立て・保存・印刷）に失敗したときに出す文言（理由はログに残す） */
const EXPORT_ERROR_MESSAGE = 'レポートを書き出せませんでした';

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
 * 図をすべて描く。描けなかった図は結果に入れない（レポートではソースのコードブロックのまま残す）。
 *
 * @param diagrams - 描く図
 * @returns 描けた図（キーは {@link diagramKey}、値は SVG の `data:` URI）
 */
async function renderDiagrams(
  diagrams: ReportDiagram[]
): Promise<Map<string, string>> {
  const rendered = new Map<string, string>();
  const plantUml = diagrams.filter((diagram) => diagram.kind === 'plantuml');
  const mermaidDiagrams = diagrams.filter(
    (diagram) => diagram.kind === 'mermaid'
  );
  await Promise.all(
    plantUml.map(async (diagram) => {
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
 * 添付画像を、レポートに埋め込む `data:` URI にする。読めなかった画像は `null`（レポートでは注記にする）。
 *
 * 送ったばかりの画像は表示の URL がもう `data:` URI、DB から読み直した画像は `/api/attachments/[id]` から読む。
 *
 * @param image - 添付画像
 * @returns 埋め込む画像。読めなければ `null`
 */
async function loadImage(image: MessageImage): Promise<ReportImage> {
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
 * 応答・会話を HTML のレポートにして保存する・PDF のために印刷を開く（#36。`docs/24-html-report-export.md`）。
 *
 * 流れ: 本文から図を拾う → 図を描く（Mermaid はブラウザ・PlantUML は API）・添付画像を読む → HTML を組み立てる
 * → `html` はファイルに保存、`pdf` は iframe で印刷を開く。描けなかった図・読めなかった画像はレポートの中で
 * ソース・注記にして書き出しを続ける。組み立て・保存・印刷そのものに失敗したときだけ `error` に文言を入れる。
 *
 * @returns `isWorking` は書き出しの途中か、`error` は直前の失敗の文言（無ければ `null`）、
 *   `exportReport` は書き出す関数（成功したら true）
 */
export function useReportExport() {
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportReport = useCallback(
    async (request: ReportExportRequest): Promise<boolean> => {
      setIsWorking(true);
      setError(null);
      try {
        const diagrams = await renderDiagrams(
          collectDiagrams(
            request.messages
              .filter((message) => message.role === 'assistant')
              .map((message) => message.content)
          )
        );
        const messages = await Promise.all(
          request.messages.map(async (message) => ({
            role: message.role,
            content: message.content,
            createdAt: message.createdAt,
            interrupted: message.metadata?.interrupted === true,
            images: await Promise.all((message.images ?? []).map(loadImage)),
          }))
        );
        const html = buildReportHtml(
          {
            mode: request.mode,
            title: request.title,
            exportedAt: request.exportedAt,
            systemPrompt: request.systemPrompt,
            messages,
          },
          diagrams
        );
        if (request.format === 'pdf') {
          await printHtml(html);
        } else {
          // 応答 1 件はその応答の日時、会話全体は書き出した日時をファイル名にする（Markdown の書き出しと同じ）
          const fileDate =
            request.mode === 'message' && request.messages[0]
              ? request.messages[0].createdAt
              : request.exportedAt;
          downloadTextFile(
            buildExportFileName(request.title, fileDate, 'html'),
            html,
            HTML_MIME
          );
        }
        return true;
      } catch (err) {
        console.error('Failed to export report:', err);
        setError(EXPORT_ERROR_MESSAGE);
        return false;
      } finally {
        setIsWorking(false);
      }
    },
    []
  );

  return { isWorking, error, exportReport };
}
