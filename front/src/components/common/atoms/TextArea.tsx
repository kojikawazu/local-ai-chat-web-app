import type { ComponentProps } from 'react';
import { cn } from '@/lib/shared/class-names';

/** {@link TextArea} の props。素の `<textarea>` の props を受け取る。 */
type TextAreaProps = ComponentProps<'textarea'>;

/**
 * 複数行の入力欄（共通の atom。#163）。縦方向だけ大きさを変えられる。
 *
 * 外から渡す `className` は配置（幅）に限り、色を上書きしない。
 *
 * @param props - 素の `<textarea>` の props
 */
export default function TextArea({ className, ...props }: TextAreaProps) {
  return (
    <textarea
      className={cn(
        'px-3 py-2 rounded-lg text-sm border border-nord-3 bg-nord-2 text-nord-6 placeholder-nord-4/40 resize-y focus:outline-none focus:ring-2 focus:ring-nord-frost-1/50',
        className
      )}
      {...props}
    />
  );
}
