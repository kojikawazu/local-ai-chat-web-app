import type { ComponentProps } from 'react';
import { cn } from '@/lib/shared/class-names';

/** {@link TextInput} の props。素の `<input>` の props を受け取る。 */
type TextInputProps = ComponentProps<'input'>;

/**
 * 1 行の入力欄（共通の atom。#163）。`type` の既定は `'text'`。
 *
 * 外から渡す `className` は配置（幅・アイコンを置くための左右の余白）に限り、色を上書きしない。
 *
 * @param props - 素の `<input>` の props
 */
export default function TextInput({
  type = 'text',
  className,
  ...props
}: TextInputProps) {
  return (
    <input
      type={type}
      className={cn(
        'rounded-lg border border-nord-3 bg-nord-0 px-3 py-2 text-sm text-nord-6 placeholder:text-nord-4/40 focus:border-nord-frost-1 focus:outline-none',
        className
      )}
      {...props}
    />
  );
}
