'use client';

import { CornerDownRight } from 'lucide-react';
import { cn } from '@/lib/shared/class-names';

/** 指示の状態ごとの見出し */
const LABELS = {
  read: '追加の指示',
  pending: '追加の指示（次の区切りで読みます）',
  unread: '追加の指示（読まれませんでした）',
} as const;

/** {@link InstructionNote} の props。 */
type InstructionNoteProps = {
  /** 指示の本文 */
  content: string;
  /** 状態（読んだ・まだ読まれていない・読まれずに終わった）。省略時は読んだ */
  state?: keyof typeof LABELS;
};

/**
 * 応答の途中で利用者が送った指示（割り込み。#241。`docs/30-agent-interrupt.md`）を、応答の中に出す。
 *
 * 読まれた指示は時系列（`AgentSteps`）の読んだ位置に、まだ読まれていない・読まれなかった指示は応答の下に出す。
 * 本文は利用者の書いた文のため、Markdown として描かずに文字のまま出す。
 *
 * @param props - 本文と状態
 */
export default function InstructionNote({
  content,
  state = 'read',
}: InstructionNoteProps) {
  return (
    <div
      role="note"
      aria-label={LABELS[state]}
      className={cn(
        'flex gap-2 rounded-md border px-3 py-2 text-sm',
        state === 'read'
          ? 'border-nord-frost-1/50 bg-nord-frost-1/10'
          : 'border-dashed border-nord-3 bg-nord-1',
        state === 'unread' && 'opacity-60'
      )}
    >
      <CornerDownRight
        size={16}
        aria-hidden
        className="mt-0.5 shrink-0 text-nord-frost-1"
      />
      <div className="min-w-0">
        <p className="text-xs text-nord-4/70">{LABELS[state]}</p>
        <p className="whitespace-pre-wrap break-words text-nord-6">{content}</p>
      </div>
    </div>
  );
}
