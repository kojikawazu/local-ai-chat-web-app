'use client';

import { Network } from 'lucide-react';
import { cn } from '@/lib/shared/class-names';

/** {@link SubAgentToggle} の props。 */
type SubAgentToggleProps = {
  /** サブエージェントに任せるか（`aria-pressed`。設定の「サブエージェントに任せる」と同じ値） */
  pressed: boolean;
  /** 押したときに呼ぶ。切り替えた後の値を受け取る */
  onChange: (pressed: boolean) => void;
};

/** ボタンの名前（`aria-label`）。設定の切り替えと同じ文言にする */
const LABEL = 'サブエージェントに任せる';

/**
 * 「サブエージェントに任せる」（#26。`docs/29-multi-agent.md`「設定」）を入力欄の横で切り替えるボタン。
 *
 * 設定のモーダルの切り替えと同じ値を持ち、どちらで変えても同じになる。送る前に、どの設定で送るかが見えるようにする
 * （設定のモーダルにしか出ないと、モデルが任せなかったのか設定が効いていないのかを画面から区別できなかった）。
 * 入っている間は枠と色で強調し、`aria-pressed` で読み上げさせる（「ドキュメントを参照」の本のボタンと同じ形）。
 *
 * @param props - 入っているか・切り替えの処理
 */
export default function SubAgentToggle({
  pressed,
  onChange,
}: SubAgentToggleProps) {
  return (
    <button
      type="button"
      aria-label={LABEL}
      aria-pressed={pressed}
      title={pressed ? `${LABEL}（オン）` : `${LABEL}（オフ）`}
      onClick={() => onChange(!pressed)}
      className={cn(
        'p-2.5 rounded-xl border transition-colors focus:outline-none focus:ring-2 focus:ring-nord-frost-1/50',
        pressed
          ? 'border-nord-frost-1 bg-nord-frost-1/20 text-nord-frost-1'
          : 'border-transparent text-nord-4/60 hover:bg-white/5 hover:text-nord-6'
      )}
    >
      <Network size={20} />
    </button>
  );
}
