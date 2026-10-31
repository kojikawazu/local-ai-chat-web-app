'use client';

import { Plus, Settings2 } from 'lucide-react';
import type { PromptTemplate } from '@/types/prompt-template/prompt-template';
import { getSuggestionOptionId } from '@/lib/prompt-template/suggest';
import { cn } from '@/lib/shared/class-names';
import Button from '@/components/common/atoms/Button';

/** {@link PromptTemplateSuggestions} の props。 */
type PromptTemplateSuggestionsProps = {
  /** 候補の一覧（`listbox`）の ID。入力欄の `aria-controls`・`aria-activedescendant` と揃える */
  listId: string;
  /** 絞り込んだ候補（並べる順） */
  matches: PromptTemplate[];
  /** テンプレートが 1 件でもあるか。無ければ「例を追加」を出し、あれば「一致するものが無い」と出す */
  hasTemplates: boolean;
  /** 選択中の候補の位置（0 始まり） */
  activeIndex: number;
  /** 候補を押したときに呼ぶ。押したテンプレートを受け取る */
  onSelect: (template: PromptTemplate) => void;
  /** 「テンプレートを管理」を押したときに呼ぶ */
  onManage: () => void;
  /** 「例を追加」を押したときに呼ぶ */
  onAddExamples: () => void;
};

/**
 * 入力欄の上に重ねて出す、プロンプトテンプレートの候補（#28）。
 *
 * キー操作（↑↓・Enter・Tab・Escape）は入力欄（`ChatBar`）が受け、ここは描画と押したときの処理だけを持つ。
 * 押しても入力欄のフォーカスを外さないよう、`mousedown` の既定の動作を止める。
 *
 * @param props - 候補・選択中の位置・押したときの処理
 */
export default function PromptTemplateSuggestions({
  listId,
  matches,
  hasTemplates,
  activeIndex,
  onSelect,
  onManage,
  onAddExamples,
}: PromptTemplateSuggestionsProps) {
  return (
    <div
      onMouseDown={(e) => e.preventDefault()}
      className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-nord-3 bg-nord-2 shadow-xl shadow-black/30 overflow-hidden"
    >
      <ul
        id={listId}
        role="listbox"
        aria-label="プロンプトテンプレート"
        className="max-h-64 overflow-y-auto py-1"
      >
        {matches.map((template, index) => (
          <li
            key={template.id}
            id={getSuggestionOptionId(listId, index)}
            role="option"
            aria-selected={index === activeIndex}
            onClick={() => onSelect(template)}
            className={cn(
              'flex items-baseline gap-3 px-4 py-2 cursor-pointer text-sm',
              index === activeIndex ? 'bg-nord-frost-1/20' : 'hover:bg-white/5'
            )}
          >
            <span className="font-mono text-nord-frost-1 shrink-0">
              /{template.shortcut}
            </span>
            <span className="text-nord-6 truncate">{template.name}</span>
          </li>
        ))}
      </ul>
      {matches.length === 0 && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 text-sm text-nord-4/70">
          {hasTemplates ? (
            <span>一致するテンプレートはありません</span>
          ) : (
            <>
              <span>テンプレートがありません</span>
              <Button variant="link" onClick={onAddExamples}>
                <Plus size={14} />
                例を追加
              </Button>
            </>
          )}
        </div>
      )}
      <div className="border-t border-nord-3 px-4 py-2">
        <Button variant="link" onClick={onManage}>
          <Settings2 size={14} />
          テンプレートを管理
        </Button>
      </div>
    </div>
  );
}
