'use client';

import {
  useState,
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from 'react';
import { Send, Square } from 'lucide-react';
import { MAX_MESSAGE_LENGTH } from '@/lib/validation';

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
}

/**
 * メッセージ入力バー。textarea への入力・自動高さ調整・送信を担う。
 *
 * Enter で送信、Shift+Enter で改行。IME 変換確定中の Enter は送信しない。
 * 応答の生成中は送信ボタンが停止ボタンに替わり、入力欄での Escape でも停止できる
 * （IME の変換中の Escape は変換の取り消しなので停止しない）。
 * 入力が {@link MAX_MESSAGE_LENGTH} を超えると送信不可となり警告を表示する。
 * `ref` から {@link ChatBarHandle} を通じて入力欄へフォーカスできる。
 *
 * @param props - 送信・停止のコールバックと、無効化・生成中のフラグを持つ props
 * @param ref - 入力欄フォーカス操作を公開する forwardRef
 */
const ChatBar = forwardRef<ChatBarHandle, ChatBarProps>(function ChatBar(
  { onSendMessage, disabled, isGenerating, onStop },
  ref
) {
  const [content, setContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
  }));

  const trimmed = content.trim();
  const isOverLimit = trimmed.length > MAX_MESSAGE_LENGTH;
  const canSend = trimmed.length > 0 && !isOverLimit && !disabled;

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (canSend) {
      onSendMessage(trimmed);
      setContent('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && isGenerating && !isComposingRef.current) {
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
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 240)}px`;
    }
  }, [content]);

  return (
    <div className="p-4 md:p-8 bg-nord-1 border-t border-nord-3">
      <div className="max-w-4xl mx-auto">
        <form
          onSubmit={handleSubmit}
          className="flex items-end gap-3 p-3 rounded-2xl bg-nord-3 shadow-xl shadow-black/20 transition-all focus-within:ring-2 focus-within:ring-nord-frost-1/50"
        >
          <textarea
            ref={textareaRef}
            rows={1}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
            }}
            maxLength={MAX_MESSAGE_LENGTH + 100}
            placeholder="Ask anything..."
            className="w-full bg-transparent border-none focus:ring-0 focus:outline-none p-2 text-sm md:text-base text-nord-6 placeholder-nord-4/50 resize-none min-h-[44px]"
          />

          <div className="flex gap-2 pb-1 pl-1">
            {isGenerating ? (
              <button
                type="button"
                onClick={onStop}
                aria-label="生成を停止"
                className="p-2.5 rounded-xl transition-all bg-nord-frost-1 text-nord-0 hover:bg-nord-frost-2"
              >
                <Square size={20} fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSend}
                className={`p-2.5 rounded-xl transition-all ${
                  canSend
                    ? 'bg-nord-frost-1 text-nord-0 hover:bg-nord-frost-2 font-bold'
                    : 'opacity-20 cursor-not-allowed text-nord-4'
                }`}
              >
                <Send size={20} />
              </button>
            )}
          </div>
        </form>
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
