'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { ROLE_PRESETS } from '@/lib/chat/system-prompt';
import { MAX_CONVERSATION_SYSTEM_PROMPT_LENGTH } from '@/lib/shared/validation';

/** {@link RoleDialog} の props。 */
type RoleDialogProps = {
  /** 開いた時点の役割（入力欄の初期値）。役割なしは空文字。 */
  initialPrompt: string;
  /**
   * 保存ボタン押下時に呼ぶ。保存に失敗したら例外を投げる（ダイアログに表示し、入力を残す）。
   * 成功したらダイアログを閉じる。
   */
  onSave: (systemPrompt: string) => Promise<void>;
  /** 閉じる要求（キャンセル・閉じるボタン・Escape）で呼ぶ。 */
  onClose: () => void;
};

/**
 * 会話の役割（システムプロンプト）を編集するダイアログ（#10）。
 *
 * プリセットを選ぶと入力欄に本文が入り、そのまま書き換えてもよい（保存するのは本文だけ）。
 * 空にして保存すると役割を外す。変更は以降の送信から効く。
 *
 * 開いている間だけ描画する（呼び出し側で条件付きで置く）。開くたびに作り直されるため、
 * 入力欄は毎回 `initialPrompt` から始まる。ネイティブの `<dialog>` を `showModal()` で開き、
 * フォーカスの閉じ込め・背景の操作の無効化・Escape での取り消しはブラウザに任せる。
 *
 * @param props - 初期値・保存処理・閉じる処理を持つ props
 */
export default function RoleDialog({
  initialPrompt,
  onSave,
  onClose,
}: RoleDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const textareaId = useId();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await onSave(prompt.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '役割の保存に失敗しました');
      setIsSaving(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      // Escape はブラウザが閉じる前に cancel を送る。閉じるかは React の状態で決めるため既定動作は止める
      onCancel={(e) => {
        e.preventDefault();
        if (!isSaving) onClose();
      }}
      className="w-full max-w-lg m-auto rounded-2xl bg-nord-1 text-nord-6 border border-nord-3 shadow-2xl shadow-black/40 backdrop:bg-black/60"
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-nord-3">
        <h2 id={titleId} className="text-lg font-bold">
          会話の役割
        </h2>
        <button
          type="button"
          onClick={onClose}
          disabled={isSaving}
          aria-label="閉じる"
          className="p-1.5 rounded-lg text-nord-4/60 hover:bg-white/5 hover:text-nord-6 transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      <div className="px-6 py-4 space-y-4">
        <p className="text-xs text-nord-4/80">
          AI
          にどんな役割で答えさせるかを決めます。変更は次の送信から効き、これまでの応答はそのまま残ります。
        </p>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setPrompt('')}
            aria-pressed={prompt.trim() === ''}
            className="px-3 py-1.5 rounded-lg text-xs border border-nord-3 hover:bg-nord-2 aria-pressed:bg-nord-frost-1/20 aria-pressed:border-nord-frost-1 transition-colors"
          >
            役割なし
          </button>
          {ROLE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => setPrompt(preset.prompt)}
              aria-pressed={prompt.trim() === preset.prompt}
              className="px-3 py-1.5 rounded-lg text-xs border border-nord-3 hover:bg-nord-2 aria-pressed:bg-nord-frost-1/20 aria-pressed:border-nord-frost-1 transition-colors"
            >
              {preset.name}
            </button>
          ))}
        </div>

        <div className="space-y-1">
          <label htmlFor={textareaId} className="text-sm font-semibold">
            役割（システムプロンプト）
          </label>
          <textarea
            id={textareaId}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={MAX_CONVERSATION_SYSTEM_PROMPT_LENGTH}
            rows={6}
            placeholder="例: あなたは優秀な翻訳者です。"
            className="w-full px-3 py-2 rounded-lg text-sm border border-nord-3 bg-nord-2 text-nord-6 placeholder-nord-4/40 resize-y focus:outline-none focus:ring-2 focus:ring-nord-frost-1/50"
          />
          <p className="text-right text-xs text-nord-4/60">
            {prompt.length.toLocaleString('ja-JP')} /{' '}
            {MAX_CONVERSATION_SYSTEM_PROMPT_LENGTH.toLocaleString('ja-JP')}
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-nord-aurora-red">
            {error}
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2 px-6 py-4 border-t border-nord-3">
        <button
          type="button"
          onClick={onClose}
          disabled={isSaving}
          className="px-4 py-2 rounded-lg text-sm text-nord-4 hover:bg-white/5 transition-colors"
        >
          キャンセル
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="px-4 py-2 rounded-lg text-sm font-bold bg-nord-frost-1 text-nord-0 hover:bg-nord-frost-2 disabled:opacity-50 transition-colors"
        >
          {isSaving ? '保存中…' : '保存'}
        </button>
      </div>
    </dialog>
  );
}
