import type { ComponentProps } from 'react';
import { cn } from '@/lib/shared/class-names';

/** アイコンボタンの色の種類。 */
type IconButtonTone = 'default' | 'muted' | 'danger' | 'primary' | 'inherit';
/** アイコンボタンの大きさ（内側の余白）。 */
type IconButtonSize = 'xs' | 'sm' | 'md' | 'lg';

/** {@link IconButton} の props。素の `<button>` の props を受け取る（`aria-label` は `label` で渡す）。 */
type IconButtonProps = Omit<ComponentProps<'button'>, 'aria-label'> & {
  /** ボタンの名前（`aria-label`）。アイコンだけで文字が無いため必須 */
  label: string;
  /**
   * 色。`muted` は控えめな操作（閉じる・設定）、`default` は少し目立たせる操作（メニュー）、
   * `danger` は削除、`primary` は主な操作（送信・停止）、`inherit` は周りの文字色のまま hover で色だけ付ける
   * （文字の並びに混ぜるコピー等）。省略時は `muted`
   */
  tone?: IconButtonTone;
  /**
   * 大きさ。`xs` は余白なし（文字の並びに混ぜる）、`sm` は `p-1.5`、`md` は `p-2`、`lg` は `p-2.5` の
   * 角の大きいボタン。省略時は `md`
   */
  size?: IconButtonSize;
};

const TONE_CLASSES: Record<IconButtonTone, string> = {
  muted: 'text-nord-4/60 hover:bg-white/5 hover:text-nord-6',
  default: 'text-nord-4 hover:bg-white/5 hover:text-nord-6',
  danger: 'text-nord-4/40 hover:text-nord-aurora-red',
  inherit: 'hover:text-nord-frost-1',
  // 押せないときは背景を消して薄くする（送信ボタンの「入力が空」の見た目）
  primary:
    'bg-nord-frost-1 text-nord-0 hover:bg-nord-frost-2 disabled:bg-transparent disabled:text-nord-4 disabled:opacity-20 disabled:cursor-not-allowed',
};

/**
 * 押せないとき（`disabled`）の見た目。`primary` は送信ボタン用の見た目を `TONE_CLASSES` に持つため除く。
 * 薄くして hover の色を付けない（押せるボタンと区別できるように。#176）
 */
const DISABLED_CLASSES =
  'disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-current';

const SIZE_CLASSES: Record<IconButtonSize, string> = {
  xs: 'rounded',
  sm: 'p-1.5 rounded-lg',
  md: 'p-2 rounded-lg',
  lg: 'p-2.5 rounded-xl',
};

/**
 * アイコンだけのボタン（共通の atom。#163）。
 *
 * 文字が無いため `label` を必須にし、`aria-label` として読み上げさせる。`type` の既定は `'button'`。
 * 外から渡す `className` は配置（位置・外側の余白・表示条件）に限り、色を上書きしない。
 *
 * @param props - 名前・色・大きさと、素の `<button>` の props（中身のアイコンは `children`）
 */
export default function IconButton({
  label,
  tone = 'muted',
  size = 'md',
  type = 'button',
  className,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      // 削除ボタンの表示の切り替え（opacity）も滑らかにするため、色だけでなく transition 全般を付ける
      className={cn(
        SIZE_CLASSES[size],
        TONE_CLASSES[tone],
        tone !== 'primary' && DISABLED_CLASSES,
        'transition',
        className
      )}
      {...props}
    />
  );
}
