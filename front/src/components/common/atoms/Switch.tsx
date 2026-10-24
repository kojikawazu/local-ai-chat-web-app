import { cn } from '@/lib/shared/class-names';

/** {@link Switch} の props。 */
type SwitchProps = {
  /** オンか。つまみの位置と色が変わる */
  checked: boolean;
  /** 外側の要素に足すクラス（配置の指定に限る） */
  className?: string;
};

/**
 * オン・オフのスイッチの見た目（つまみと溝。共通の atom。#163）。
 *
 * 見た目だけを描き、読み上げからは隠す。操作（クリック）と状態の読み上げは、ラベルの文字ごと
 * 包んだ呼び出し側の要素が持つ（行全体を押せるようにするため。設定のツールの ON/OFF）。
 *
 * @param props - オンかと、配置用のクラス
 */
export default function Switch({ checked, className }: SwitchProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative block w-11 h-6 rounded-full transition-colors shrink-0',
        checked ? 'bg-nord-frost-1' : 'bg-nord-3',
        className
      )}
    >
      <span
        className={cn(
          'absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-6' : 'translate-x-1'
        )}
      />
    </span>
  );
}
