'use client';

import type { ComponentProps } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/shared/class-names';
import IconButton from '@/components/common/atoms/IconButton';
import TextInput from '@/components/common/atoms/TextInput';

/** {@link SearchBox} の props。素の `<input>` の props も受け取る（値の受け渡しは `value`・`onValueChange`）。 */
type SearchBoxProps = Omit<
  ComponentProps<'input'>,
  'value' | 'onChange' | 'type' | 'aria-label' | 'className'
> & {
  /** 入力中の文字列 */
  value: string;
  /** 入力が変わったときに呼ぶ。引数は入力後の文字列 */
  onValueChange: (value: string) => void;
  /** クリアの × ボタン・Escape で呼ぶ（入力が空のときは出さない・呼ばない） */
  onClear: () => void;
  /** 入力欄の名前（`aria-label`）。プレースホルダーにも使う */
  label: string;
  /** クリアの × ボタンの名前 */
  clearLabel: string;
  /** 外側の要素に足すクラス（配置の指定に限る） */
  className?: string;
};

/**
 * 検索欄（共通の molecule。#163）。虫眼鏡のアイコン・入力欄・クリアの × ボタンを重ねる。
 *
 * 入力がある間だけ × ボタンを出し、Escape でもクリアする。そのときの Escape は外へ伝えない
 * （ドロワーの中に置いたとき、ドロワーを閉じずに検索だけをやめるため）。入力が空なら Escape は外へ伝える。
 *
 * @param props - 値・変更とクリアの処理・名前と、素の `<input>` の props
 */
export default function SearchBox({
  value,
  onValueChange,
  onClear,
  label,
  clearLabel,
  className,
  onKeyDown,
  ...props
}: SearchBoxProps) {
  return (
    <div role="search" className={cn('relative', className)}>
      <Search
        size={16}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-nord-4/60"
      />
      <TextInput
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          // Shift+Escape は入力欄へ移るショートカット（#33）のため、検索の取り消しに使わない
          if (e.key === 'Escape' && !e.shiftKey && value) {
            e.stopPropagation();
            onClear();
          }
        }}
        placeholder={label}
        aria-label={label}
        // 左右のアイコン（虫眼鏡・×）の分だけ余白を空ける
        className="w-full pl-9 pr-9"
        {...props}
      />
      {value && (
        <IconButton
          label={clearLabel}
          size="sm"
          onClick={onClear}
          className="absolute right-1.5 top-1/2 -translate-y-1/2"
        >
          <X size={14} />
        </IconButton>
      )}
    </div>
  );
}
