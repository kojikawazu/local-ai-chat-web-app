'use client';

import { useId, useState } from 'react';
import { ROLE_PRESETS } from '@/lib/chat/system-prompt';
import { MAX_CONVERSATION_SYSTEM_PROMPT_LENGTH } from '@/lib/shared/validation';
import Button from '@/components/common/atoms/Button';
import TextArea from '@/components/common/atoms/TextArea';
import ToggleChip from '@/components/common/atoms/ToggleChip';
import Modal from '@/components/common/molecules/Modal';

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
 * 入力欄は毎回 `initialPrompt` から始まる。外枠は共通の {@link Modal}（ネイティブの `<dialog>`）。
 * 入力を失わないよう、背景のクリックでは閉じない。保存中は閉じさせない。
 *
 * @param props - 初期値・保存処理・閉じる処理を持つ props
 */
export default function RoleDialog({
  initialPrompt,
  onSave,
  onClose,
}: RoleDialogProps) {
  const textareaId = useId();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <Modal
      title="会話の役割"
      onClose={onClose}
      closeDisabled={isSaving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            キャンセル
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-nord-4/80">
          AI
          にどんな役割で答えさせるかを決めます。変更は次の送信から効き、これまでの応答はそのまま残ります。
        </p>

        <div className="flex flex-wrap gap-2">
          <ToggleChip
            pressed={prompt.trim() === ''}
            onClick={() => setPrompt('')}
          >
            役割なし
          </ToggleChip>
          {ROLE_PRESETS.map((preset) => (
            <ToggleChip
              key={preset.id}
              pressed={prompt.trim() === preset.prompt}
              onClick={() => setPrompt(preset.prompt)}
            >
              {preset.name}
            </ToggleChip>
          ))}
        </div>

        <div className="space-y-1">
          <label htmlFor={textareaId} className="text-sm font-semibold">
            役割（システムプロンプト）
          </label>
          <TextArea
            id={textareaId}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={MAX_CONVERSATION_SYSTEM_PROMPT_LENGTH}
            rows={6}
            placeholder="例: あなたは優秀な翻訳者です。"
            className="w-full"
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
    </Modal>
  );
}
