import type { ComponentProps } from 'react';
import { cn } from '@/lib/shared/class-names';

/** ボタンの見た目の種類。 */
type ButtonVariant = 'primary' | 'secondary' | 'subtle' | 'link';
/** ボタンの大きさ（左右の余白）。`link` では使わない。 */
type ButtonSize = 'sm' | 'md' | 'lg';

/** {@link Button} の props。素の `<button>` の props を受け取る。 */
type ButtonProps = ComponentProps<'button'> & {
  /**
   * 見た目。`primary` は主な操作（保存・閉じる）、`secondary` は取り消し等の控えめな操作、
   * `subtle` は一覧の中の補助的な操作（さらに表示）、`link` は文字だけのリンク風（再試行・再生成）。
   * 省略時は `primary`
   */
  variant?: ButtonVariant;
  /** 大きさ。省略時は `md`。`link` では無視する */
  size?: ButtonSize;
};

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'rounded-lg text-sm font-bold bg-nord-frost-1 text-nord-0 hover:bg-nord-frost-2 disabled:opacity-50 transition-colors',
  secondary:
    'rounded-lg text-sm text-nord-4 hover:bg-white/5 disabled:opacity-50 transition-colors',
  subtle: 'rounded-lg text-sm text-nord-frost-1 hover:bg-white/5',
  link: 'flex items-center gap-1 text-nord-frost-1 hover:underline disabled:opacity-50 disabled:no-underline',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-3 py-2',
  md: 'px-4 py-2',
  lg: 'px-6 py-2',
};

/**
 * 文字のボタン（共通の atom。#163）。
 *
 * `type` の既定は `'button'`（フォームの中に置いても、意図せず送信しない）。
 * 外から渡す `className` は配置（幅・外側の余白）に限り、色を上書きしない。
 *
 * @param props - 見た目・大きさと、素の `<button>` の props
 */
export default function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        VARIANT_CLASSES[variant],
        variant !== 'link' && SIZE_CLASSES[size],
        className
      )}
      {...props}
    />
  );
}
