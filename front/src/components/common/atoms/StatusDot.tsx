import { cn } from '@/lib/shared/class-names';

/** 丸の色の種類。 */
type StatusDotTone = 'frost' | 'green';
/** 丸の大きさ。 */
type StatusDotSize = 'sm' | 'md';

/** {@link StatusDot} の props。 */
type StatusDotProps = {
  /** 色。`frost` は選択中・生成中、`green` は接続中（光彩付き）。省略時は `frost` */
  tone?: StatusDotTone;
  /** 大きさ。`sm` は 8px、`md` は 10px。省略時は `sm` */
  size?: StatusDotSize;
  /** 点滅させるか（生成中など、続いている状態を示す） */
  pulse?: boolean;
  /**
   * 読み上げる名前。渡すと画像（`role="img"`）として読み上げ、省略すると飾りとして隠す
   * （隣の文字が同じ意味を伝えている場合）
   */
  label?: string;
  /** 外側の要素に足すクラス（配置の指定に限る） */
  className?: string;
};

const TONE_CLASSES: Record<StatusDotTone, string> = {
  frost: 'bg-nord-frost-1',
  green: 'bg-nord-aurora-green shadow-[0_0_8px_#a3be8c]',
};

const SIZE_CLASSES: Record<StatusDotSize, string> = {
  sm: 'w-2 h-2',
  md: 'w-2.5 h-2.5',
};

/**
 * 状態を示す小さな丸（共通の atom。#163）。生成中の印・選択中の印・接続状態に使う。
 *
 * @param props - 色・大きさ・点滅・読み上げる名前と、配置用のクラス
 */
export default function StatusDot({
  tone = 'frost',
  size = 'sm',
  pulse = false,
  label,
  className,
}: StatusDotProps) {
  return (
    <span
      {...(label
        ? { role: 'img', 'aria-label': label }
        : { 'aria-hidden': true })}
      className={cn(
        'block shrink-0 rounded-full',
        SIZE_CLASSES[size],
        TONE_CLASSES[tone],
        pulse && 'animate-pulse',
        className
      )}
    />
  );
}
