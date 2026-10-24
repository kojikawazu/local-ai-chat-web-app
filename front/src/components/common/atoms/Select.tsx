import type { ComponentProps } from 'react';
import { cn } from '@/lib/shared/class-names';

/** 選択欄の見た目の種類。 */
type SelectVariant = 'default' | 'compact';

/** {@link Select} の props。素の `<select>` の props を受け取る。 */
type SelectProps = ComponentProps<'select'> & {
  /**
   * 見た目。`default` はフォームの選択欄（ブラウザの矢印を出す）、`compact` はヘッダーに置く
   * 小さな選択欄（ブラウザの矢印を消す。矢印のアイコンは呼び出し側が重ねる）。省略時は `default`
   */
  variant?: SelectVariant;
};

const VARIANT_CLASSES: Record<SelectVariant, string> = {
  default:
    'px-4 py-2.5 rounded-lg text-sm border border-nord-3 bg-nord-2 text-nord-6 focus:outline-none focus:ring-2 focus:ring-nord-frost-1/50',
  compact:
    'appearance-none pl-4 pr-8 py-1.5 rounded-lg text-xs font-bold border border-nord-3 bg-nord-2 text-nord-6 cursor-pointer hover:bg-nord-3 transition-colors focus:outline-none focus:ring-2 focus:ring-nord-frost-1/50',
};

/**
 * 選択欄（共通の atom。#163）。選択肢は `children` の `<option>` で渡す。
 *
 * 外から渡す `className` は配置（幅・省略表示）に限り、色を上書きしない。
 *
 * @param props - 見た目と、素の `<select>` の props
 */
export default function Select({
  variant = 'default',
  className,
  ...props
}: SelectProps) {
  return (
    <select className={cn(VARIANT_CLASSES[variant], className)} {...props} />
  );
}
