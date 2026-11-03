'use client';

import { BookOpen } from 'lucide-react';
import { cn } from '@/lib/shared/class-names';

/** 入れられないときに出す理由（ドキュメントが 1 つも無い） */
const NO_DOCUMENTS_REASON =
  'ドキュメントがありません。サイドバーの「ドキュメント」から取り込んでください';

/** {@link KnowledgeToggle} の props。 */
type KnowledgeToggleProps = {
  /** この会話でドキュメントを参照しているか（`aria-pressed`） */
  pressed: boolean;
  /** 取り込んだドキュメントが無いなら true。入れることだけを止める（入っていれば外せる） */
  noDocuments: boolean;
  /** 押したときに呼ぶ。切り替えた後の値を受け取る */
  onChange: (pressed: boolean) => void;
};

/** ボタンの名前（`aria-label`）。理由は名前に混ぜない（名前で探すほかのボタンと取り違えないよう、短く保つ） */
const LABEL = 'ドキュメントを参照';

/**
 * 会話ごとに「ドキュメントを参照」を切り替える本のアイコンのボタン（#17 Phase B。`docs/28-rag.md`「切り替え」）。
 *
 * 入っている間は枠と色で強調し、`aria-pressed` で読み上げさせる。ドキュメントが無いときは入れられないが、
 * `disabled` にはせず `aria-disabled` にする（フォーカスでき、理由を `title` で伝えるため。`aria-label` があるとき、
 * `title` は説明として読み上げられる）。
 *
 * @param props - 入っているか・ドキュメントが無いか・切り替えの処理
 */
export default function KnowledgeToggle({
  pressed,
  noDocuments,
  onChange,
}: KnowledgeToggleProps) {
  const blocked = noDocuments && !pressed;

  return (
    <button
      type="button"
      aria-label={LABEL}
      aria-pressed={pressed}
      aria-disabled={blocked || undefined}
      title={blocked ? `${LABEL}（${NO_DOCUMENTS_REASON}）` : LABEL}
      onClick={() => {
        if (!blocked) onChange(!pressed);
      }}
      className={cn(
        'p-2.5 rounded-xl border transition-colors focus:outline-none focus:ring-2 focus:ring-nord-frost-1/50',
        pressed
          ? 'border-nord-frost-1 bg-nord-frost-1/20 text-nord-frost-1'
          : blocked
            ? 'border-transparent text-nord-4/60 opacity-30 cursor-not-allowed'
            : 'border-transparent text-nord-4/60 hover:bg-white/5 hover:text-nord-6'
      )}
    >
      <BookOpen size={20} />
    </button>
  );
}
