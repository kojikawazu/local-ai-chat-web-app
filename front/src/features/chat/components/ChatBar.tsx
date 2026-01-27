'use client';

import { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Send } from 'lucide-react';

const MAX_MESSAGE_LENGTH = 10000;

export interface ChatBarHandle {
  focus: () => void;
}

interface ChatBarProps {
  onSendMessage: (content: string) => void;
  disabled?: boolean;
}

const ChatBar = forwardRef<ChatBarHandle, ChatBarProps>(function ChatBar(
  { onSendMessage, disabled },
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
