'use client';

import { useId, useState } from 'react';
import { Plus } from 'lucide-react';
import type { PromptTemplate } from '@/types/prompt-template/prompt-template';
import {
  isValidPromptTemplateShortcut,
  MAX_MESSAGE_LENGTH,
  MAX_PROMPT_TEMPLATE_NAME_LENGTH,
  MAX_PROMPT_TEMPLATE_SHORTCUT_LENGTH,
} from '@/lib/shared/validation';
import Button from '@/components/common/atoms/Button';
import TextArea from '@/components/common/atoms/TextArea';
import TextInput from '@/components/common/atoms/TextInput';
import Modal from '@/components/common/molecules/Modal';

/** フォームの入力（作成・置き換えで送る値）。 */
type TemplateInput = Pick<PromptTemplate, 'name' | 'shortcut' | 'content'>;

/** 開いているフォーム。同時に開くのは 1 つだけ。 */
type Editing = { mode: 'new' } | { mode: 'edit'; id: string };

const EMPTY_INPUT: TemplateInput = { name: '', shortcut: '', content: '' };

/** {@link PromptTemplateDialog} の props。 */
type PromptTemplateDialogProps = {
  /** テンプレートの一覧。読めなかったときは `null` */
  templates: PromptTemplate[] | null;
  /** 作成する。失敗したら例外を投げる（フォームに出し、入力を残す） */
  onCreate: (input: TemplateInput) => Promise<void>;
  /** 置き換える。失敗したら例外を投げる */
  onUpdate: (id: string, input: TemplateInput) => Promise<void>;
  /** 削除する。失敗したら例外を投げる */
  onDelete: (id: string) => Promise<void>;
  /** 例の 3 件を作る（一覧が空のとき）。失敗したら例外を投げる */
  onAddExamples: () => Promise<void>;
  /** 閉じる要求（閉じるボタン・Escape）で呼ぶ */
  onClose: () => void;
};

/**
 * 例外から画面に出す文言を取り出す。
 *
 * @param error - 捕まえた例外
 * @param fallback - `Error` でないときの文言
 * @returns 画面に出す文言
 */
function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * プロンプトテンプレートの一覧・作成・編集・削除のダイアログ（#28。`docs/20-prompt-templates.md`「管理画面」）。
 *
 * 編集はその行をフォームに替える（同時に開くフォームは 1 つ）。削除は行の中で 2 段階で確かめる。
 * 保存・削除の失敗（重複の 409 を含む）は API の `error` を出し、入力を残す。
 * 開いている間だけ描画する（呼び出し側で条件付きで置く）。入力を失わないよう、背景のクリックでは閉じない。
 *
 * @param props - 一覧と、変更・閉じる処理
 */
export default function PromptTemplateDialog({
  templates,
  onCreate,
  onUpdate,
  onDelete,
  onAddExamples,
  onClose,
}: PromptTemplateDialogProps) {
  const formId = useId();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [input, setInput] = useState<TemplateInput>(EMPTY_INPUT);
  const [formError, setFormError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null
  );
  const [isBusy, setIsBusy] = useState(false);

  const normalizedShortcut = input.shortcut.trim().toLowerCase();
  const isShortcutInvalid =
    normalizedShortcut !== '' &&
    !isValidPromptTemplateShortcut(normalizedShortcut);
  const canSave =
    !isBusy &&
    input.name.trim() !== '' &&
    normalizedShortcut !== '' &&
    !isShortcutInvalid &&
    input.content.trim() !== '';

  /**
   * フォームを開く（開いていたフォームの入力は捨てる）。
   *
   * @param next - 開くフォーム
   * @param initial - フォームの初期値
   */
  const openForm = (next: Editing, initial: TemplateInput) => {
    setEditing(next);
    setInput(initial);
    setFormError(null);
    setConfirmingDeleteId(null);
  };

  const closeForm = () => {
    setEditing(null);
    setFormError(null);
  };

  const handleSave = async () => {
    if (!editing || !canSave) return;
    setIsBusy(true);
    setFormError(null);
    try {
      if (editing.mode === 'new') await onCreate(input);
      else await onUpdate(editing.id, input);
      closeForm();
    } catch (error) {
      setFormError(errorMessage(error, 'テンプレートの保存に失敗しました'));
    } finally {
      setIsBusy(false);
    }
  };

  /**
   * 一覧に対する操作（削除・例の追加）を行い、失敗を一覧の下に出す。
   *
   * @param action - 行う操作
   * @param fallback - 例外が `Error` でないときの文言
   */
  const runListAction = async (
    action: () => Promise<void>,
    fallback: string
  ) => {
    setIsBusy(true);
    setListError(null);
    try {
      await action();
      setConfirmingDeleteId(null);
    } catch (error) {
      setListError(errorMessage(error, fallback));
    } finally {
      setIsBusy(false);
    }
  };

  const form = editing && (
    <div
      role="group"
      aria-label={
        editing.mode === 'new' ? '新しいテンプレート' : 'テンプレートの編集'
      }
      className="space-y-3 rounded-lg border border-nord-frost-1/50 bg-nord-2 p-3"
    >
      <div className="space-y-1">
        <label htmlFor={`${formId}-name`} className="text-sm font-semibold">
          名前
        </label>
        <TextInput
          id={`${formId}-name`}
          value={input.name}
          onChange={(e) => setInput({ ...input, name: e.target.value })}
          maxLength={MAX_PROMPT_TEMPLATE_NAME_LENGTH}
          placeholder="例: 英語に翻訳"
          className="w-full"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${formId}-shortcut`} className="text-sm font-semibold">
          ショートカット
        </label>
        <div className="flex items-center gap-1">
          <span className="font-mono text-nord-frost-1">/</span>
          <TextInput
            id={`${formId}-shortcut`}
            value={input.shortcut}
            onChange={(e) => setInput({ ...input, shortcut: e.target.value })}
            maxLength={MAX_PROMPT_TEMPLATE_SHORTCUT_LENGTH}
            placeholder="translate"
            aria-invalid={isShortcutInvalid}
            aria-describedby={`${formId}-shortcut-hint`}
            className="w-full font-mono"
          />
        </div>
        <p
          id={`${formId}-shortcut-hint`}
          className={
            isShortcutInvalid
              ? 'text-xs text-nord-aurora-red'
              : 'text-xs text-nord-4/60'
          }
        >
          英小文字・数字・「-」・「_」（英小文字か数字で始める）
        </p>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${formId}-content`} className="text-sm font-semibold">
          本文
        </label>
        <TextArea
          id={`${formId}-content`}
          value={input.content}
          onChange={(e) => setInput({ ...input, content: e.target.value })}
          maxLength={MAX_MESSAGE_LENGTH}
          rows={5}
          placeholder="例: 以下を自然な英語に翻訳してください。"
          className="w-full"
        />
      </div>
      {formError && (
        <p role="alert" className="text-sm text-nord-aurora-red">
          {formError}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={closeForm} disabled={isBusy}>
          やめる
        </Button>
        <Button onClick={handleSave} disabled={!canSave}>
          {isBusy ? '保存中…' : '保存'}
        </Button>
      </div>
    </div>
  );

  return (
    <Modal
      title="プロンプトテンプレート"
      onClose={onClose}
      closeDisabled={isBusy}
      footer={
        <Button variant="secondary" onClick={onClose} disabled={isBusy}>
          閉じる
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-nord-4/80">
          入力欄の先頭で「/」を打つと候補が出て、選んだテンプレートの本文が入力欄に入ります。
        </p>

        {editing?.mode === 'new' ? (
          form
        ) : (
          <Button
            variant="link"
            onClick={() => openForm({ mode: 'new' }, EMPTY_INPUT)}
            disabled={isBusy}
          >
            <Plus size={14} />
            新しいテンプレート
          </Button>
        )}

        {templates === null && (
          <p className="text-sm text-nord-aurora-red">
            テンプレートの一覧を読み込めませんでした
          </p>
        )}

        {templates?.length === 0 && editing?.mode !== 'new' && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-nord-3 px-4 py-3 text-sm text-nord-4/70">
            <span>テンプレートがありません</span>
            <Button
              variant="link"
              onClick={() =>
                runListAction(
                  onAddExamples,
                  '例のテンプレートの作成に失敗しました'
                )
              }
              disabled={isBusy}
            >
              <Plus size={14} />
              例を追加
            </Button>
          </div>
        )}

        {templates && templates.length > 0 && (
          <ul aria-label="テンプレートの一覧" className="space-y-2">
            {templates.map((template) =>
              editing?.mode === 'edit' && editing.id === template.id ? (
                <li key={template.id}>{form}</li>
              ) : (
                <li
                  key={template.id}
                  aria-label={`/${template.shortcut}`}
                  className="flex items-start gap-3 rounded-lg border border-nord-3 bg-nord-2 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-baseline gap-2 text-sm">
                      <span className="font-mono text-nord-frost-1">
                        /{template.shortcut}
                      </span>
                      <span className="truncate font-semibold text-nord-6">
                        {template.name}
                      </span>
                    </p>
                    <p className="truncate text-xs text-nord-4/60">
                      {template.content.trim().split('\n')[0]}
                    </p>
                  </div>
                  {confirmingDeleteId === template.id ? (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        onClick={() =>
                          runListAction(
                            () => onDelete(template.id),
                            'テンプレートの削除に失敗しました'
                          )
                        }
                        disabled={isBusy}
                      >
                        削除する
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setConfirmingDeleteId(null)}
                        disabled={isBusy}
                      >
                        やめる
                      </Button>
                    </div>
                  ) : (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          openForm(
                            { mode: 'edit', id: template.id },
                            {
                              name: template.name,
                              shortcut: template.shortcut,
                              content: template.content,
                            }
                          )
                        }
                        disabled={isBusy}
                      >
                        編集
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setListError(null);
                          setConfirmingDeleteId(template.id);
                        }}
                        disabled={isBusy}
                      >
                        削除
                      </Button>
                    </div>
                  )}
                </li>
              )
            )}
          </ul>
        )}

        {listError && (
          <p role="alert" className="text-sm text-nord-aurora-red">
            {listError}
          </p>
        )}
      </div>
    </Modal>
  );
}
