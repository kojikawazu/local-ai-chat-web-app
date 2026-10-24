import type { ComponentProps } from 'react';
import { cn } from '@/lib/shared/class-names';

/** {@link ToggleChip} の props。素の `<button>` の props を受け取る（`aria-pressed` は `pressed` で渡す）。 */
type ToggleChipProps = Omit<ComponentProps<'button'>, 'aria-pressed'> & {
  /** 選ばれているか（`aria-pressed`）。選ばれている間は枠と背景を強調する */
  pressed: boolean;
};

/**
 * 選ぶ・外すを切り替える小さなボタン（共通の atom。#163）。プリセットの選択などに使う。
 *
 * 選ばれているかは `aria-pressed` で読み上げさせ、見た目もその属性で切り替える。
 *
 * @param props - 選ばれているかと、素の `<button>` の props
 */
export default function ToggleChip({
  pressed,
  type = 'button',
  className,
  ...props
}: ToggleChipProps) {
  return (
    <button
      type={type}
      aria-pressed={pressed}
      className={cn(
        'px-3 py-1.5 rounded-lg text-xs border border-nord-3 hover:bg-nord-2 aria-pressed:bg-nord-frost-1/20 aria-pressed:border-nord-frost-1 transition-colors',
        className
      )}
      {...props}
    />
  );
}
