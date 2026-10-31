'use client';

import {
  useState,
  useRef,
  useEffect,
  useId,
  useImperativeHandle,
  forwardRef,
} from 'react';
import { Send, Square } from 'lucide-react';
import type { MessageImage } from '@/types/chat/message';
import type { PromptTemplate } from '@/types/prompt-template/prompt-template';
import { MAX_MESSAGE_LENGTH } from '@/lib/shared/validation';
import {
  filterTemplates,
  getSuggestionOptionId,
  getTemplateQuery,
  moveSuggestionIndex,
} from '@/lib/prompt-template/suggest';
import { cn } from '@/lib/shared/class-names';
import IconButton from '@/components/common/atoms/IconButton';
import AttachButton from '@/components/features/chat/atoms/AttachButton';
import AttachmentPreview from '@/components/features/chat/molecules/AttachmentPreview';
import PromptTemplateSuggestions from '@/components/features/chat/molecules/PromptTemplateSuggestions';

/** 親コンポーネントから {@link ChatBar} を操作するための命令的ハンドル。 */
export interface ChatBarHandle {
  /** 入力欄（textarea）にフォーカスを移す。 */
  focus: () => void;
}

/** {@link ChatBar} の props。 */
interface ChatBarProps {
  /** メッセージ送信時のコールバック。トリム済みの本文を受け取る。 */
  onSendMessage: (content: string) => void;
  /** 送信を無効化するか（応答生成中など）。省略時は有効。 */
  disabled?: boolean;
  /** 応答の生成中か。true の間は送信ボタンの代わりに停止ボタンを出し、Escape でも停止できる。 */
  isGenerating?: boolean;
  /** 停止ボタン・Escape で呼ばれるコールバック。 */
  onStop?: () => void;
  /**
   * 画像を添付するときに呼ぶ（#6。添付ボタン・ドラッグ＆ドロップ・貼り付け）。添付するファイルを受け取る。
   * 省略時は添付ボタンを出さず、ドロップ・貼り付けのファイルも受けない。
   */
  onAddImages?: (files: File[]) => void;
  /** 添付済みの画像（添付した順）。省略時は無し。 */
  images?: MessageImage[];
  /** 縮小・再エンコードの途中の枚数。1 枚以上の間は送信できない。省略時は 0。 */
  preparingImageCount?: number;
  /** 直近の添付で外した理由。省略時は無し。 */
  attachmentErrors?: string[];
  /**
   * 選択中のモデルが画像に対応していないときのモデル名。画像を添付している間は案内を出し、送信できなくする。
   * 対応している・分からないときは `null`（省略時も同じ）。
   */
  unsupportedImageModel?: string | null;
  /** 添付した画像の削除ボタンで呼ぶ。外す画像の ID を受け取る。 */
  onRemoveImage?: (id: string) => void;
  /**
   * プロンプトテンプレートの一覧（#28）。入力欄の先頭で `/` を打つと候補を出す。
   * 読み込み中・読めなかったとき（`null`）と省略時は候補を出さない。
   */
  templates?: PromptTemplate[] | null;
  /** 候補の「テンプレートを管理」で呼ぶ。 */
  onManageTemplates?: () => void;
  /** 候補の「例を追加」（テンプレートが 1 件も無いとき）で呼ぶ。 */
  onAddExampleTemplates?: () => void;
}

/**
 * メッセージ入力バー。textarea への入力・自動高さ調整・送信を担う。
 *
 * Enter で送信、Shift+Enter で改行。IME 変換確定中の Enter は送信しない。
 * 応答の生成中は送信ボタンが停止ボタンに替わり、入力欄での Escape でも停止できる
 * （IME の変換中の Escape は変換の取り消しなので停止しない）。
 * 入力が {@link MAX_MESSAGE_LENGTH} を超えると送信不可となり警告を表示する。
 * 画像は添付ボタン・入力欄へのドラッグ＆ドロップ・入力欄への貼り付けで添付し（#6）、入力欄の上にプレビューを出す。
 * 本文は画像を添付していても必須。画像の準備中と、画像に対応していないモデルで画像を添付している間は送信できない。
 * 入力欄の先頭で `/` を打つとプロンプトテンプレートの候補を出し（#28）、↑↓ で選び、Enter・Tab・クリックで
 * `/…` を本文に置き換える。候補が出ている間の Escape は候補を閉じるだけで、生成は止めない。
 * 一致する候補が無いときの Enter はいつもどおり送信する。
 * `ref` から {@link ChatBarHandle} を通じて入力欄へフォーカスできる。
 *
 * @param props - 送信・停止のコールバックと、無効化・生成中のフラグを持つ props
 * @param ref - 入力欄フォーカス操作を公開する forwardRef
 */
const ChatBar = forwardRef<ChatBarHandle, ChatBarProps>(function ChatBar(
  {
    onSendMessage,
    disabled,
    isGenerating,
    onStop,
    onAddImages,
    images = [],
    preparingImageCount = 0,
    attachmentErrors = [],
    unsupportedImageModel = null,
    onRemoveImage,
    templates = null,
    onManageTemplates,
    onAddExampleTemplates,
  },
  ref
) {
  const [content, setContent] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  // Escape で候補を閉じたときの入力。書き換えるまで候補を出し直さない
  const [dismissedContent, setDismissedContent] = useState<string | null>(null);
  // 選択中の候補。絞り込みの語が変わったら先頭に戻すため、語と組で持つ（effect で戻さない）
  const [activeSuggestion, setActiveSuggestion] = useState({
    query: '',
    index: 0,
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);
  // テンプレートを入れた直後に、カーソルを本文の末尾へ動かす
  const moveCaretToEndRef = useRef(false);
  const suggestionListId = useId();

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
  }));

  const trimmed = content.trim();
  const isOverLimit = trimmed.length > MAX_MESSAGE_LENGTH;
  const isBlockedByImages =
    preparingImageCount > 0 ||
    (images.length > 0 && unsupportedImageModel !== null);
  const canSend =
    trimmed.length > 0 && !isOverLimit && !disabled && !isBlockedByImages;

  const templateQuery = templates ? getTemplateQuery(content) : null;
  const isSuggesting =
    templates !== null &&
    templateQuery !== null &&
    content !== dismissedContent;
  const matches =
    isSuggesting && templates ? filterTemplates(templates, templateQuery) : [];
  const activeIndex =
    activeSuggestion.query === templateQuery &&
    activeSuggestion.index < matches.length
      ? activeSuggestion.index
      : 0;

  /**
   * 選んだテンプレートの本文で、入力欄の `/…` を置き換える。
   *
   * @param template - 入れるテンプレート
   */
  const applyTemplate = (template: PromptTemplate) => {
    setContent(template.content);
    // 本文そのものが `/` で始まるときに、入れた直後に候補が開き直さないようにする
    setDismissedContent(template.content);
    moveCaretToEndRef.current = true;
    textareaRef.current?.focus();
  };

  /**
   * 候補が出ている間のキー操作を処理する。
   *
   * @param e - 入力欄のキーのイベント
   * @returns 候補の操作として処理した（既定の動作・送信・停止をしない）なら true
   */
  const handleSuggestionKey = (e: React.KeyboardEvent): boolean => {
    if (!isSuggesting || isComposingRef.current) return false;
    // Shift+Escape は入力欄へ移るショートカット（#33）。候補を閉じるのは Escape だけ
    if (e.key === 'Escape' && !e.shiftKey) {
      setDismissedContent(content);
      return true;
    }
    if (matches.length === 0) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      setActiveSuggestion({
        query: templateQuery ?? '',
        index: moveSuggestionIndex(
          activeIndex,
          e.key === 'ArrowDown' ? 1 : -1,
          matches.length
        ),
      });
      return true;
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
      applyTemplate(matches[activeIndex]);
      return true;
    }
    return false;
  };

  /**
   * ドラッグしているものがファイルかを判定する（文字や画面内の要素のドラッグは受けない）。
   *
   * @param e - ドラッグのイベント
   * @returns 添付を受け付けていて、ファイルをドラッグしていれば true
   */
  const isFileDrag = (e: React.DragEvent) =>
    onAddImages !== undefined && e.dataTransfer.types.includes('Files');

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (canSend) {
      onSendMessage(trimmed);
      setContent('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (handleSuggestionKey(e)) {
      e.preventDefault();
      return;
    }
    // Shift+Escape（入力欄へ移るショートカット。#33）では生成を止めない
    if (
      e.key === 'Escape' &&
      !e.shiftKey &&
      isGenerating &&
      !isComposingRef.current
    ) {
      e.preventDefault();
      onStop?.();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !isComposingRef.current) {
      e.preventDefault();
      handleSubmit();
    }
  };

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 240)}px`;
    if (moveCaretToEndRef.current) {
      moveCaretToEndRef.current = false;
      textarea.setSelectionRange(content.length, content.length);
      textarea.scrollTop = textarea.scrollHeight;
    }
  }, [content]);

  return (
    <div className="p-4 md:p-8 bg-nord-1 border-t border-nord-3">
      <div className="max-w-4xl mx-auto">
        <AttachmentPreview
          images={images}
          preparingCount={preparingImageCount}
          errors={attachmentErrors}
          unsupportedModel={unsupportedImageModel}
          onRemove={(id) => onRemoveImage?.(id)}
        />
        <div className="relative">
          {isSuggesting && templates && (
            <PromptTemplateSuggestions
              listId={suggestionListId}
              matches={matches}
              hasTemplates={templates.length > 0}
              activeIndex={activeIndex}
              onSelect={applyTemplate}
              onManage={() => onManageTemplates?.()}
              onAddExamples={() => onAddExampleTemplates?.()}
            />
          )}
          <form
            onSubmit={handleSubmit}
            onDragOver={(e) => {
              if (!isFileDrag(e)) return;
              // 既定ではドロップを受けない（ブラウザがファイルを開く）ため、受けることを示す
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={(e) => {
              // 中の要素へ移っただけのときも dragleave が起きる。フォームの外へ出たときだけ戻す
              if (
                e.relatedTarget instanceof Node &&
                e.currentTarget.contains(e.relatedTarget)
              ) {
                return;
              }
              setIsDragging(false);
            }}
            onDrop={(e) => {
              if (!isFileDrag(e)) return;
              e.preventDefault();
              setIsDragging(false);
              onAddImages?.(Array.from(e.dataTransfer.files));
            }}
            className={cn(
              'flex items-end gap-3 p-3 rounded-2xl bg-nord-3 shadow-xl shadow-black/20 transition-all focus-within:ring-2 focus-within:ring-nord-frost-1/50',
              isDragging && 'ring-2 ring-nord-frost-1'
            )}
          >
            {onAddImages && (
              <div className="pb-1">
                <AttachButton onSelectFiles={onAddImages} />
              </div>
            )}
            <textarea
              ref={textareaRef}
              rows={1}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={(e) => {
                // 画像のファイルがあれば添付する。文字の貼り付けは止めない（既定の動作のまま入力欄に入る）
                const files = Array.from(e.clipboardData.files);
                if (onAddImages && files.length > 0) onAddImages(files);
              }}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              maxLength={MAX_MESSAGE_LENGTH + 100}
              placeholder="Ask anything..."
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={isSuggesting}
              aria-controls={isSuggesting ? suggestionListId : undefined}
              aria-activedescendant={
                isSuggesting && matches.length > 0
                  ? getSuggestionOptionId(suggestionListId, activeIndex)
                  : undefined
              }
              className="w-full bg-transparent border-none focus:ring-0 focus:outline-none p-2 text-sm md:text-base text-nord-6 placeholder-nord-4/50 resize-none min-h-[44px]"
            />

            <div className="flex gap-2 pb-1 pl-1">
              {isGenerating ? (
                <IconButton
                  label="生成を停止"
                  tone="primary"
                  size="lg"
                  onClick={onStop}
                >
                  <Square size={20} fill="currentColor" />
                </IconButton>
              ) : (
                <IconButton
                  label="送信"
                  tone="primary"
                  size="lg"
                  type="submit"
                  disabled={!canSend}
                >
                  <Send size={20} />
                </IconButton>
              )}
            </div>
          </form>
        </div>
        {isOverLimit && (
          <p className="mt-2 text-xs text-nord-aurora-red text-right">
            メッセージは{MAX_MESSAGE_LENGTH.toLocaleString()}
            文字以内で入力してください（現在: {trimmed.length.toLocaleString()}
            文字）
          </p>
        )}
      </div>
    </div>
  );
});

export default ChatBar;
