'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, ZoomIn, ZoomOut } from 'lucide-react';
import type { DiagramKind } from '@/types/chat/diagram';
import { getPngSize, stepZoom, withBackground } from '@/lib/chat/diagram';
import { buildExportFileName } from '@/lib/chat/export';
import { downloadBlob, downloadTextFile } from '@/lib/shared/download';
import { svgToPngBlob } from '@/lib/shared/image';
import Button from '@/components/common/atoms/Button';
import IconButton from '@/components/common/atoms/IconButton';
import ToggleChip from '@/components/common/atoms/ToggleChip';
import Modal from '@/components/common/molecules/Modal';

/** 図の地の色を読む CSS 変数（コードブロックの `bg-nord-0` と同じ） */
const BACKGROUND_VARIABLE = '--color-nord-0';

/** PlantUML の図の地の色。PlantUML は既定の白い地で描く（`docs/11` の「配色」） */
const PLANTUML_BACKGROUND = '#ffffff';

/** 表示の倍率。`fit` はダイアログに収まるよう縮める（開いたときの既定） */
type ZoomScale = number | 'fit';

/** {@link DiagramZoomDialog} の props。 */
type DiagramZoomDialogProps = {
  /** 図の種類。保存のファイル名と、保存するときの地の色の決め方に使う。 */
  kind: DiagramKind;
  /** ダイアログの見出し（`Mermaid の図` 等）。`<img>` の `alt` にも使う。 */
  title: string;
  /** 図の SVG の data: URI。 */
  src: string;
  /** 図の SVG の文字列（SVG での保存に使う）。 */
  svg: string;
  /** 閉じる要求（×・Escape・背景のクリック）で呼ぶ。 */
  onClose: () => void;
};

/**
 * 今のテーマの、図の地の色を読む。
 *
 * @returns CSS の色の値（例: `#2e3440`）
 */
function readThemeBackground(): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(BACKGROUND_VARIABLE)
    .trim();
}

/**
 * 図を大きく表示し、SVG / PNG で保存するダイアログ（#176）。
 *
 * 倍率は「全体」（収まるよう縮める）と、`stepZoom` の段階（25%〜400%）から選ぶ。はみ出した図はスクロールで見る。
 * 今の倍率は、「全体」のときも実際の表示の大きさを測って出す（`ResizeObserver`）。
 * 保存はブラウザの中だけで行い、サーバーへは送らない。Mermaid は背景が透明で文字が明るい色のため、
 * 保存するときに画面と同じ地の色を付ける（`withBackground`）。PNG にできなかったときは理由を出し、閉じない。
 *
 * @param props - 図の種類・見出し・SVG と閉じる処理を持つ props
 */
export default function DiagramZoomDialog({
  kind,
  title,
  src,
  svg,
  onClose,
}: DiagramZoomDialogProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [scale, setScale] = useState<ZoomScale>('fit');
  const [naturalSize, setNaturalSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  // 実際に表示している倍率（表示の幅 / 元の幅）。「全体」のときの倍率は、ダイアログの大きさで決まるため測る
  const [displayScale, setDisplayScale] = useState<number | null>(null);
  const [pngError, setPngError] = useState<string | null>(null);
  const [isSavingPng, setIsSavingPng] = useState(false);

  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    // 画像の読み込み・倍率の変更・ウィンドウの大きさの変更で、表示の大きさが変わるたびに測り直す
    const observer = new ResizeObserver(() => {
      if (image.naturalWidth > 0) {
        // 表示と同じ 1% 単位に丸める。レイアウトの端数（0.998 等）のまま段階を選ぶと、
        // 「100%」と表示しているのに拡大で 100% へ移り、押しても変わらないように見える
        const measured =
          image.getBoundingClientRect().width / image.naturalWidth;
        setDisplayScale(Math.round(measured * 100) / 100);
      }
    });
    observer.observe(image);
    return () => observer.disconnect();
  }, []);

  const isFit = scale === 'fit';
  // 段階を選んでいるときはその倍率、「全体」のときは測った倍率（読み込むまでは不明）
  const currentScale = isFit ? displayScale : scale;
  const zoomInTarget =
    currentScale === null ? null : stepZoom(currentScale, 'in');
  const zoomOutTarget =
    currentScale === null ? null : stepZoom(currentScale, 'out');

  const saveSvg = () => {
    const content =
      kind === 'mermaid' ? withBackground(svg, readThemeBackground()) : svg;
    downloadTextFile(
      buildExportFileName(kind, new Date(), 'svg'),
      content,
      'image/svg+xml'
    );
  };

  const savePng = async () => {
    setPngError(null);
    const size =
      naturalSize && getPngSize(naturalSize.width, naturalSize.height);
    if (!size) {
      setPngError('図の大きさを読み取れませんでした');
      return;
    }
    // ファイル名の日時は、変換を待つ前の押した時刻にする
    const fileName = buildExportFileName(kind, new Date(), 'png');
    setIsSavingPng(true);
    try {
      const blob = await svgToPngBlob(src, {
        ...size,
        background:
          kind === 'mermaid' ? readThemeBackground() : PLANTUML_BACKGROUND,
      });
      downloadBlob(fileName, blob);
    } catch (error) {
      console.error('Failed to convert diagram to PNG:', error);
      setPngError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSavingPng(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      closeOnBackdropClick
      size="wide"
      footer={
        <div className="flex flex-wrap items-center gap-2 w-full">
          <IconButton
            label="縮小"
            size="sm"
            onClick={() => zoomOutTarget !== null && setScale(zoomOutTarget)}
            disabled={zoomOutTarget === null}
          >
            <ZoomOut size={18} />
          </IconButton>
          <span
            data-testid="diagram-zoom-level"
            aria-live="polite"
            className="min-w-12 text-center text-sm tabular-nums"
          >
            {currentScale === null ? '—' : `${Math.round(currentScale * 100)}%`}
          </span>
          <IconButton
            label="拡大"
            size="sm"
            onClick={() => zoomInTarget !== null && setScale(zoomInTarget)}
            disabled={zoomInTarget === null}
          >
            <ZoomIn size={18} />
          </IconButton>
          <ToggleChip pressed={isFit} onClick={() => setScale('fit')}>
            全体
          </ToggleChip>
          <ToggleChip pressed={scale === 1} onClick={() => setScale(1)}>
            100%
          </ToggleChip>

          <div className="flex items-center gap-2 ml-auto">
            <Button variant="secondary" size="sm" onClick={saveSvg}>
              <span className="flex items-center gap-1.5">
                <Download size={16} />
                SVG
              </span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void savePng()}
              disabled={isSavingPng || naturalSize === null}
            >
              <span className="flex items-center gap-1.5">
                <Download size={16} />
                PNG
              </span>
            </Button>
          </div>
          {pngError && (
            <p
              role="alert"
              data-testid="diagram-png-error"
              className="w-full text-xs text-nord-aurora-red break-words"
            >
              PNG にできませんでした: {pngError}
            </p>
          )}
        </div>
      }
    >
      <div
        className={
          isFit
            ? 'flex h-full rounded-lg bg-nord-0 p-4'
            : 'flex min-w-full min-h-full w-max rounded-lg bg-nord-0 p-4'
        }
      >
        {/* data: URI の SVG は next/image の最適化の対象外のため素の img を使う。
            m-auto で中央に置く（justify-center だと、はみ出した左端・上端がスクロールで見えなくなる） */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imageRef}
          src={src}
          alt={title}
          data-testid="diagram-zoom-image"
          onLoad={(e) =>
            setNaturalSize({
              width: e.currentTarget.naturalWidth,
              height: e.currentTarget.naturalHeight,
            })
          }
          className={
            isFit ? 'm-auto max-w-full max-h-full' : 'm-auto max-w-none'
          }
          style={
            !isFit && naturalSize
              ? { width: naturalSize.width * scale }
              : undefined
          }
        />
      </div>
    </Modal>
  );
}
