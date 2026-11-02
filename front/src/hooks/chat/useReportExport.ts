'use client';

import { useCallback, useState } from 'react';
import { buildReportDocument } from '@/lib/chat/document-model';
import { buildExportFileName } from '@/lib/chat/export';
import {
  diagramsToPng,
  loadReportImage,
  renderDiagrams,
} from '@/lib/chat/report-assets';
import { buildDocx } from '@/lib/chat/report-docx';
import { layoutPptx } from '@/lib/chat/pptx-layout';
import { buildPptx } from '@/lib/chat/report-pptx';
import type { ReportInput } from '@/lib/chat/report-html';
import { buildReportHtml, collectDiagrams } from '@/lib/chat/report-html';
import { buildSlidesHtml } from '@/lib/chat/report-slides';
import { downloadBlob, downloadTextFile } from '@/lib/shared/download';
import { printHtml } from '@/lib/shared/print';
import type { Message } from '@/types/chat/message';

/**
 * レポートの形式。`html` はファイルに保存、`pdf` は同じ HTML をブラウザの印刷で開く、`docx` は Word のファイルに保存する、
 * `slides` は応答 1 件を HTML スライドで、`pptx` は応答 1 件を PowerPoint のファイルで保存する（この 2 つは会話全体には使わない）
 */
export type ReportFormat = 'html' | 'pdf' | 'docx' | 'slides' | 'pptx';

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

/** HTML スライドのファイルの拡張子（同じ応答の HTML レポートと上書きし合わないよう、`.html` の前に印を付ける） */
const SLIDES_EXTENSION = 'slides.html';

/** HTML のファイルの MIME タイプ */
const HTML_MIME = 'text/html;charset=utf-8';

/** 書き出しそのもの（組み立て・保存・印刷）に失敗したときに出す文言（理由はログに残す） */
const EXPORT_ERROR_MESSAGE = 'レポートを書き出せませんでした';

/**
 * 応答・会話を HTML のレポート・PDF・DOCX・HTML スライド・PPTX にする（#36。`docs/24-html-report-export.md`・
 * `docs/25-docx-export.md`・`docs/26-html-slides-export.md`・`docs/27-pptx-export.md`）。
 *
 * 流れ: 本文から図を拾う → 図を描く・添付画像を読む（`report-assets.ts`。形式で共通）→
 * `html` / `pdf` は HTML を組み立てて保存 / 印刷、`docx` は図を PNG にし、文書の中間の形から `import('docx')` で
 * DOCX を作って保存する（docx は大きいため、DOCX を選んだときだけ読み込む）。`slides` は応答 1 件（`messages` の先頭）の
 * 本文をスライドに分けて保存する（添付画像は入れない）。`pptx` は同じ分け方で割り付けを決め、図を PNG にして
 * `import('pptxgenjs')` で PPTX を作る（pptxgenjs も PPTX を選んだときだけ読み込む）。描けなかった図・読めなかった画像は
 * ソース・注記にして書き出しを続け、組み立て・保存・印刷そのものに失敗したときだけ `error` に文言を入れる。
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
        // 応答 1 件はその応答の日時、会話全体は書き出した日時をファイル名にする（Markdown の書き出しと同じ）
        const fileDate =
          request.mode === 'message' && request.messages[0]
            ? request.messages[0].createdAt
            : request.exportedAt;

        if (request.format === 'slides' || request.format === 'pptx') {
          const [message] = request.messages;
          if (!message) throw new Error('No message to export as slides');
          const slidesInput = {
            title: request.title,
            content: message.content,
            interrupted: message.metadata?.interrupted === true,
          };
          if (request.format === 'pptx') {
            const [{ default: PptxGenJS }, pngDiagrams] = await Promise.all([
              import('pptxgenjs'),
              diagramsToPng(diagrams),
            ]);
            const pres = buildPptx(
              PptxGenJS,
              layoutPptx(slidesInput, pngDiagrams)
            );
            // write の戻り値の型は出力の形ごとの和（string | ArrayBuffer | Blob | Uint8Array）。outputType に 'blob' を
            // 渡したときは Blob を返す（pptxgenjs の README の記載どおり）ため、その形に絞る
            const blob = (await pres.write({ outputType: 'blob' })) as Blob;
            downloadBlob(
              buildExportFileName(request.title, fileDate, 'pptx'),
              blob
            );
            return true;
          }
          downloadTextFile(
            buildExportFileName(request.title, fileDate, SLIDES_EXTENSION),
            buildSlidesHtml(slidesInput, diagrams),
            HTML_MIME
          );
          return true;
        }

        const input: ReportInput = {
          mode: request.mode,
          title: request.title,
          exportedAt: request.exportedAt,
          systemPrompt: request.systemPrompt,
          messages: await Promise.all(
            request.messages.map(async (message) => ({
              role: message.role,
              content: message.content,
              createdAt: message.createdAt,
              interrupted: message.metadata?.interrupted === true,
              images: await Promise.all(
                (message.images ?? []).map(loadReportImage)
              ),
            }))
          ),
        };

        if (request.format === 'docx') {
          const [docx, pngDiagrams] = await Promise.all([
            import('docx'),
            diagramsToPng(diagrams),
          ]);
          const document = buildDocx(
            docx,
            buildReportDocument(input, pngDiagrams)
          );
          downloadBlob(
            buildExportFileName(request.title, fileDate, 'docx'),
            await docx.Packer.toBlob(document)
          );
          return true;
        }

        const html = buildReportHtml(input, diagrams);
        if (request.format === 'pdf') {
          await printHtml(html);
        } else {
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
